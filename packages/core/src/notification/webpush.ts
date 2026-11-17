/**
 * The Web Push channel (issue #306): one encrypted POST per registered
 * device to the endpoint its push service gave it (FCM for phones with
 * Google Play services, ntfy or another UnifiedPush server otherwise, a
 * browser's push service later). The server holds no provider credentials:
 * only its own VAPID key, which the app stores.
 *
 * The payload is JSON the Android app renders itself, so it carries the
 * event, a tag (to replace or dismiss it), the app path and, for approvals,
 * the buttons. Push services see ciphertext, its size, urgency and TTL.
 *
 * | Push service answer       | Outcome                                      |
 * | ------------------------- | -------------------------------------------- |
 * | 2xx                       | delivered                                    |
 * | 404, 410                  | the subscription is gone: revoked, no retry  |
 * | 429, 5xx, network, timeout| failed: retried by the delivery queue        |
 * | any other answer          | rejected: no retry                           |
 */
import { utf8Encode } from "../utils/encoding.utils";
import type {
  NotificationChannel,
  NotificationPriority,
  OutgoingMessage,
  SendResult,
} from "./notifier";
import {
  encryptPayload,
  pushTopic,
  vapidAuthorization,
  type PushTarget,
  type VapidKeys,
} from "./webpush.crypto";

export const WEB_PUSH_CHANNEL = "webpush";

/** A registered device as the channel sees it. */
export interface StoredPushTarget extends PushTarget {
  id: string;
}

export type PushOutcome =
  | { kind: "sent" }
  /** 404 or 410: the push service forgot the subscription. */
  | { kind: "gone"; detail: string }
  /** Worth trying again later (429, 5xx, network). */
  | { kind: "failed"; detail: string }
  /** The push service refused this message (413, other 4xx). */
  | { kind: "rejected"; detail: string };

/** Where the app keeps its devices: the channel reads them and reports what happened. */
export interface PushSubscriptionStore {
  /** Whether any device can receive (kept in memory: `configured()` is synchronous). */
  hasActive(): boolean;
  /** Devices to send to: every one not revoked. */
  targets(): Promise<StoredPushTarget[]>;
  report(id: string, outcome: PushOutcome): Promise<void>;
}

export interface WebPushChannelOptions {
  store: PushSubscriptionStore;
  /** The server's VAPID keys; undefined when they can't be read. */
  keys: () => Promise<VapidKeys | undefined>;
  /** The VAPID `sub` claim: an https origin or a mailto: address. */
  subject: () => string;
  fetch?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}

/** What the app receives, before encryption. */
export type PushPayload =
  | {
      v: 1;
      kind: "show";
      id?: string;
      tag: string;
      event?: string;
      category?: string;
      title: string;
      message: string;
      path?: string;
      priority: NotificationPriority;
      actions?: OutgoingMessage["actions"];
    }
  | { v: 1; kind: "dismiss"; tag: string };

const URGENCY: Record<NotificationPriority, string> = {
  1: "high",
  0: "normal",
  [-1]: "low",
  [-2]: "very-low",
};

const DEFAULT_TTL_SECONDS = 24 * 60 * 60;
const DISMISS_TTL_SECONDS = 24 * 60 * 60;

/** The JSON the app gets for a rendered notification. */
export function showPayload(message: OutgoingMessage): PushPayload {
  return {
    v: 1,
    kind: "show",
    ...(message.id ? { id: message.id } : {}),
    tag: message.tag ?? message.id ?? message.title,
    ...(message.event ? { event: message.event } : {}),
    ...(message.category ? { category: message.category } : {}),
    title: message.title,
    message: message.message,
    ...(message.path ? { path: message.path } : {}),
    priority: message.priority,
    ...(message.actions ? { actions: message.actions } : {}),
  };
}

export interface PushRequest {
  payload: PushPayload;
  urgency: string;
  ttlSeconds: number;
}

/** POST one encrypted message to one device. */
export async function pushTo(
  target: PushTarget,
  request: PushRequest,
  options: Pick<WebPushChannelOptions, "subject" | "fetch" | "now" | "timeoutMs"> & {
    keys: VapidKeys;
  },
): Promise<PushOutcome> {
  let url: URL;
  try {
    url = new URL(target.endpoint);
  } catch {
    return { kind: "rejected", detail: "invalid endpoint" };
  }
  if (url.protocol !== "https:") return { kind: "rejected", detail: "endpoint is not https" };
  const body = await encryptPayload(utf8Encode(JSON.stringify(request.payload)), target);
  const headers: Record<string, string> = {
    Authorization: await vapidAuthorization(
      target.endpoint,
      options.keys,
      options.subject(),
      (options.now ?? Date.now)(),
    ),
    "Content-Encoding": "aes128gcm",
    "Content-Type": "application/octet-stream",
    TTL: String(request.ttlSeconds),
    Urgency: request.urgency,
    Topic: await pushTopic(request.payload.tag),
  };
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(target.endpoint, {
      method: "POST",
      headers,
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    });
  } catch (error) {
    return { kind: "failed", detail: (error as Error).name || "network error" };
  }
  const status = response.status;
  await response.body?.cancel().catch(() => undefined);
  if (status >= 200 && status < 300) return { kind: "sent" };
  if (status === 404 || status === 410) return { kind: "gone", detail: `HTTP ${status}` };
  if (status === 429 || status >= 500) return { kind: "failed", detail: `HTTP ${status}` };
  return { kind: "rejected", detail: `HTTP ${status}` };
}

export function createWebPushChannel(options: WebPushChannelOptions): NotificationChannel {
  async function fanOut(request: PushRequest): Promise<PushOutcome[]> {
    const keys = await options.keys();
    if (!keys) return [{ kind: "rejected", detail: "VAPID keys unavailable" }];
    const targets = await options.store.targets();
    return Promise.all(
      targets.map(async (target) => {
        const outcome = await pushTo(target, request, { ...options, keys });
        await options.store.report(target.id, outcome);
        return outcome;
      }),
    );
  }

  return {
    id: WEB_PUSH_CHANNEL,
    configured: () => options.store.hasActive(),
    validate: async () => ({ ok: true, devices: [] }),
    quota: async () => undefined,
    async send(message: OutgoingMessage): Promise<SendResult> {
      const outcomes = await fanOut({
        payload: showPayload(message),
        urgency: URGENCY[message.priority],
        ttlSeconds: message.ttlSeconds ?? DEFAULT_TTL_SECONDS,
      });
      const sent = outcomes.filter((outcome) => outcome.kind === "sent").length;
      if (sent > 0) return { ok: true, providerId: `${sent}/${outcomes.length}` };
      const failed = outcomes.find((outcome) => outcome.kind === "failed");
      if (failed) {
        return { ok: false, retryable: true, reason: "transient", detail: failed.detail };
      }
      const first = outcomes[0];
      return {
        ok: false,
        retryable: false,
        reason: "invalid_input",
        detail: first && "detail" in first ? first.detail : "no devices",
      };
    },
    async dismiss(tag: string): Promise<void> {
      await fanOut({
        payload: { v: 1, kind: "dismiss", tag },
        urgency: "normal",
        ttlSeconds: DISMISS_TTL_SECONDS,
      });
    },
  };
}
