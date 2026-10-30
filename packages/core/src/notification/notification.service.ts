/**
 * Push notifications (issue #57). `notify()` is the only call-site API: it
 * returns immediately, never throws and never makes the caller wait on the
 * provider. Behind it, each notification goes through
 *
 *   settings (per-event switch) → dedupe → channel state → quiet hours →
 *   coalescing → throttling → delivery queue (≤2 concurrent, retries)
 *
 * and lands in the notification log (metadata only). Without credentials the
 * whole pipeline is skipped: nothing is logged and nothing is sent.
 *
 * Delivery is in-process: a restart drops queued sends. Needs-input
 * notifications are re-derived on boot (waiting calls re-run), and the
 * log-backed dedupe keeps those replays from sending twice.
 */
import { Boom } from "@groot/core/errors";
import { env } from "@groot/core/env";
import { logger } from "@groot/core/logger";
import { createDbLogStore, type NotificationLogStore } from "./notification.log";
import {
  createKvSettingsStore,
  notificationSettingsSchema,
  quietRemainingMs,
  type NotificationSettings,
  type NotificationSettingsStore,
} from "./notification.settings";
import type {
  ChannelQuota,
  Notification,
  NotificationChannel,
  NotificationEventDef,
  NotificationPriority,
  OutgoingMessage,
  SendFailureReason,
  SendResult,
} from "./notifier";
import { createPushoverChannel } from "./pushover";
import { clamp, plainText, shapeMessage, shapeTitle } from "./scrub";

export type ChannelState =
  | "not_configured"
  | "unknown"
  | "connected"
  | "invalid_credentials"
  | "over_quota";

export interface NotificationStatus {
  channel: string;
  state: ChannelState;
  /** Env vars the channel needs (shown when not configured). */
  requiredEnv: string[];
  devices: string[];
  quota?: { limit: number; remaining: number; reset: string };
  lastError?: { reason: string; detail?: string; at: string };
  checkedAt?: string;
}

export type TestResult =
  | { ok: true; providerId: string }
  | { ok: false; reason: SendFailureReason | "not_configured"; detail?: string };

export interface NotificationServiceOptions {
  channel: NotificationChannel;
  log: NotificationLogStore;
  settings: NotificationSettingsStore;
  /** Base URL deep links start with (ORIGIN); no link without it. */
  origin: () => string | undefined;
  requiredEnv?: string[];
  now?: () => number;
  /** Delays before each retry of a transient failure; its length + 1 is the attempt cap. */
  retryDelaysMs?: readonly number[];
  random?: () => number;
}

/** Events the core itself sends; apps add theirs with `defineEvents`. */
export const CORE_EVENTS: NotificationEventDef[] = [
  {
    event: "system.started",
    label: "App started",
    description: "A silent ping when the server boots in production.",
    category: "system",
    defaultEnabled: true,
  },
];

const DEFAULT_RETRY_DELAYS_MS = [5_000, 30_000, 120_000, 600_000];
const MAX_CONCURRENT = 2;
const DEFAULT_DEDUPE_SECONDS = 24 * 60 * 60;
const SETTINGS_CACHE_MS = 10_000;
const TEST_INTERVAL_MS = 10_000;
const LOG_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const URL_MAX = 512;
const QUOTA_WARN_SHARE = 0.1;

/** A notification accepted into the pipeline, with its log row. */
interface Accepted {
  n: Notification;
  logId: string;
  priority: NotificationPriority;
  acceptedAt: number;
}

interface Delivery {
  logIds: string[];
  message: OutgoingMessage;
  botId?: string;
  attempts: number;
  /** Skip throttling (the suppression summary itself). */
  unthrottled?: boolean;
}

interface Bucket {
  items: Accepted[];
  timer: ReturnType<typeof setTimeout>;
}

const maxPriority = (items: readonly Accepted[]) =>
  items.reduce<NotificationPriority>(
    (max, item) => (item.priority > max ? item.priority : max),
    -2,
  );

/** The first of next month, 00:00 US Central (06:00 UTC), when Pushover resets. */
function nextQuotaReset(now: number): Date {
  const at = new Date(now);
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1, 6));
}

export class NotificationService {
  readonly #channel: NotificationChannel;
  readonly #log: NotificationLogStore;
  readonly #settingsStore: NotificationSettingsStore;
  readonly #origin: () => string | undefined;
  readonly #requiredEnv: string[];
  readonly #now: () => number;
  readonly #retryDelays: readonly number[];
  readonly #random: () => number;
  readonly #events = new Map<string, NotificationEventDef>();

  #state: ChannelState = "unknown";
  #devices: string[] = [];
  #quota: ChannelQuota | undefined;
  #quotaWarned = false;
  #overQuotaUntil = 0;
  #lastError: NotificationStatus["lastError"];
  #checkedAt: Date | undefined;
  #settingsCache: { value: NotificationSettings; at: number } | undefined;
  #lastTestAt = 0;
  #warnedUnconfigured = false;

  /** Dedupe keys accepted by this process, with when. */
  readonly #recent = new Map<string, number>();
  /** Keys cancelled while their notification may still be on its way in. */
  readonly #cancelled = new Map<string, number>();
  readonly #buckets = new Map<string, Bucket>();
  #held: Accepted[] = [];
  #heldTimer: ReturnType<typeof setTimeout> | undefined;
  readonly #queue: Delivery[] = [];
  #active = 0;
  /** Recent sends, for throttling. */
  #sends: { at: number; botId?: string }[] = [];
  #suppressed = 0;
  #suppressedTimer: ReturnType<typeof setTimeout> | undefined;
  readonly #timers = new Set<ReturnType<typeof setTimeout>>();
  #pruneTimer: ReturnType<typeof setInterval> | undefined;
  #stopped = false;

  constructor(options: NotificationServiceOptions) {
    this.#channel = options.channel;
    this.#log = options.log;
    this.#settingsStore = options.settings;
    this.#origin = options.origin;
    this.#requiredEnv = options.requiredEnv ?? [];
    this.#now = options.now ?? Date.now;
    this.#retryDelays = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
    this.#random = options.random ?? Math.random;
    this.defineEvents(CORE_EVENTS);
  }

  // ── Events and settings ───────────────────────────────────────────────

  /** Register events the owner can switch in Settings. */
  defineEvents(defs: readonly NotificationEventDef[]): void {
    for (const def of defs) this.#events.set(def.event, def);
  }

  events(): NotificationEventDef[] {
    return [...this.#events.values()];
  }

  async getSettings(): Promise<NotificationSettings> {
    const cached = this.#settingsCache;
    if (cached && this.#now() - cached.at < SETTINGS_CACHE_MS) return cached.value;
    const value = await this.#settingsStore.load();
    this.#settingsCache = { value, at: this.#now() };
    return value;
  }

  /** Validate and store the owner's settings (400 on invalid input). */
  async saveSettings(input: unknown): Promise<NotificationSettings> {
    const parsed = notificationSettingsSchema.safeParse(input);
    if (!parsed.success) {
      throw Boom.badRequest("Invalid notification settings", parsed.error.issues);
    }
    const value = parsed.data;
    for (const def of this.#events.values()) if (def.locked) delete value.events[def.event];
    await this.#settingsStore.save(value);
    this.#settingsCache = { value, at: this.#now() };
    return value;
  }

  // ── Sending ───────────────────────────────────────────────────────────

  /** Hand a notification to the pipeline. Returns at once; never throws. */
  notify(n: Notification): void {
    if (this.#stopped) return;
    try {
      if (!this.#channel.configured()) {
        this.#state = "not_configured";
        if (!this.#warnedUnconfigured) {
          this.#warnedUnconfigured = true;
          logger.debug("Push notifications are not configured; skipping");
        }
        return;
      }
      const now = this.#now();
      const windowMs = (n.dedupeSeconds ?? DEFAULT_DEDUPE_SECONDS) * 1000;
      const seen = this.#recent.get(n.dedupeKey);
      if (seen !== undefined && now - seen < windowMs) return;
      this.#recent.set(n.dedupeKey, now);
      if (this.#recent.size > 1000) this.#forgetOld(now);
      void this.#accept(n, now, windowMs).catch((error: unknown) => {
        logger.warn({ error, event: n.event }, "notification.failed");
      });
    } catch (error) {
      logger.warn({ error, event: n.event }, "notification.failed");
    }
  }

  /**
   * Drop a notification that has not been sent yet (still coalescing, held
   * for quiet hours or queued): the thing it announced was resolved.
   */
  cancel(dedupeKey: string): void {
    if (this.#recent.has(dedupeKey)) this.#cancelled.set(dedupeKey, this.#now());
    const cancelled: string[] = [];
    for (const [key, bucket] of this.#buckets) {
      const keep = bucket.items.filter((item) => {
        if (item.n.dedupeKey !== dedupeKey) return true;
        cancelled.push(item.logId);
        return false;
      });
      bucket.items = keep;
      if (keep.length === 0) {
        clearTimeout(bucket.timer);
        this.#timers.delete(bucket.timer);
        this.#buckets.delete(key);
      }
    }
    this.#held = this.#held.filter((item) => {
      if (item.n.dedupeKey !== dedupeKey) return true;
      cancelled.push(item.logId);
      return false;
    });
    if (cancelled.length > 0) {
      void this.#log
        .update(cancelled, { status: "cancelled" })
        .catch((error: unknown) => logger.warn({ error }, "notification log update failed"));
    }
  }

  async #accept(n: Notification, now: number, windowMs: number): Promise<void> {
    const settings = await this.getSettings();
    const def = this.#events.get(n.event);
    const enabled = def?.locked || (settings.events[n.event] ?? def?.defaultEnabled ?? true);
    const row = {
      event: n.event,
      category: n.category,
      channel: this.#channel.id,
      dedupeKey: n.dedupeKey,
      botId: n.botId ?? null,
      title: shapeTitle(n.title),
      url: n.path ?? null,
      priority: n.priority,
    };
    if (!enabled) {
      await this.#log.create({ ...row, status: "suppressed", reason: "disabled" });
      return;
    }
    // Replays after a restart: the log remembers what this process forgot.
    if (await this.#log.hasRecent(n.dedupeKey, new Date(now - windowMs))) return;

    const blocked = this.#blockedReason(now);
    if (blocked) {
      await this.#log.create({ ...row, status: "suppressed", reason: blocked });
      return;
    }

    let priority = n.priority;
    const quietMs = quietRemainingMs(new Date(now), settings.quietHours);
    if (quietMs > 0) {
      if (n.category === "notify") {
        const logId = await this.#log.create({ ...row, status: "queued", reason: "quiet_hours" });
        if (this.#cancelled.delete(n.dedupeKey)) {
          await this.#log.update([logId], { status: "cancelled" });
          return;
        }
        this.#hold({ n, logId, priority, acceptedAt: now }, quietMs);
        return;
      }
      if (n.category === "needs_input" && !settings.quietHours.urgentBypass) {
        priority = -1;
      }
      if (n.category === "security") priority = 1;
    }

    const logId = await this.#log.create({ ...row, priority, status: "queued" });
    if (this.#cancelled.delete(n.dedupeKey)) {
      // Resolved while it was being accepted.
      await this.#log.update([logId], { status: "cancelled" });
      return;
    }
    const accepted: Accepted = { n, logId, priority, acceptedAt: now };
    if (n.coalesce && settings.coalesceSeconds > 0) {
      this.#coalesce(accepted, settings.coalesceSeconds * 1000);
      return;
    }
    await this.#dispatch([accepted], settings);
  }

  #blockedReason(now: number): "invalid_credentials" | "over_quota" | undefined {
    if (this.#state === "invalid_credentials") return "invalid_credentials";
    if (this.#overQuotaUntil > now) return "over_quota";
    if (this.#state === "over_quota") this.#state = "unknown";
    return undefined;
  }

  #coalesce(item: Accepted, windowMs: number): void {
    const key = item.n.coalesce!.key;
    const bucket = this.#buckets.get(key);
    if (bucket) {
      bucket.items.push(item);
      return;
    }
    const timer = this.#later(windowMs, async () => {
      this.#buckets.delete(key);
      const items = created.items;
      if (items.length === 0) return;
      await this.#dispatch(items, await this.getSettings());
    });
    const created: Bucket = { items: [item], timer };
    this.#buckets.set(key, created);
  }

  #hold(item: Accepted, quietMs: number): void {
    this.#held.push(item);
    if (this.#heldTimer) return;
    this.#heldTimer = this.#later(quietMs, async () => {
      this.#heldTimer = undefined;
      const now = this.#now();
      const held = this.#held;
      this.#held = [];
      const expired = held.filter(
        (item) =>
          item.n.ttlSeconds !== undefined && item.acceptedAt + item.n.ttlSeconds * 1000 <= now,
      );
      const live = held.filter((item) => !expired.includes(item));
      if (expired.length > 0) {
        await this.#log.update(
          expired.map((item) => item.logId),
          { status: "suppressed", reason: "quiet_hours" },
        );
      }
      if (live.length === 0) return;
      const settings = await this.getSettings();
      if (live.length === 1) {
        await this.#dispatch(live, settings);
        return;
      }
      const titles = live.map((item) => shapeTitle(item.n.title)).join(" · ");
      await this.#dispatch(live, settings, {
        title: `${live.length} updates during quiet hours`,
        message: titles,
        path: "/",
      });
    });
  }

  /** Throttle, then queue one push for `items` (several: a summary). */
  async #dispatch(
    items: readonly Accepted[],
    settings: NotificationSettings,
    summary?: { title: string; message: string; path?: string },
  ): Promise<void> {
    const first = items[0];
    const now = this.#now();
    this.#sends = this.#sends.filter((send) => now - send.at < 60 * 60_000);
    const botId = first.n.botId;
    const perBot = botId
      ? this.#sends.filter((send) => send.botId === botId && now - send.at < 60_000).length
      : 0;
    const logIds = items.map((item) => item.logId);
    if (
      this.#sends.length >= settings.throttle.perHour ||
      (botId !== undefined && perBot >= settings.throttle.perBotPerMinute)
    ) {
      await this.#log.update(logIds, { status: "suppressed", reason: "throttled" });
      logger.info({ event: first.n.event, count: items.length }, "notification.suppressed");
      this.#noteSuppressed(items.length, now, perBot >= settings.throttle.perBotPerMinute);
      return;
    }
    this.#sends.push({ at: now, botId });

    let title = summary?.title;
    let message = summary?.message;
    if (!summary && items.length > 1 && first.n.coalesce) {
      ({ title, message } = first.n.coalesce.summarize(items.map((item) => item.n)));
    }
    title = shapeTitle(title ?? first.n.title);
    message = shapeMessage(message ?? first.n.message) || title;
    if (title !== shapeTitle(first.n.title)) await this.#log.update(logIds, { title });
    const path = summary ? summary.path : first.n.path;
    const ttls = items.map((item) => item.n.ttlSeconds);
    const ttlSeconds = ttls.every((ttl) => ttl !== undefined)
      ? Math.max(...(ttls as number[]))
      : undefined;
    this.#enqueue({
      logIds,
      botId,
      attempts: 0,
      message: {
        title,
        message,
        ...this.#link(path, summary ? undefined : first.n.urlTitle),
        priority: maxPriority(items),
        ttlSeconds,
        device: settings.device || undefined,
      },
    });
  }

  #link(path: string | undefined, urlTitle: string | undefined) {
    const origin = this.#origin()?.trim().replace(/\/+$/, "");
    if (!origin || !path) return {};
    const url = `${origin}${path.startsWith("/") ? path : `/${path}`}`;
    if (url.length > URL_MAX) return {};
    return { url, urlTitle: urlTitle ? clamp(plainText(urlTitle), 100) : undefined };
  }

  /**
   * Count throttled notifications and send one "N suppressed" summary when
   * the window that throttled them ends.
   */
  #noteSuppressed(count: number, now: number, perBot: boolean): void {
    this.#suppressed += count;
    if (this.#suppressedTimer) return;
    const oldest = this.#sends[0]?.at ?? now;
    const delay = perBot ? 60_000 : Math.max(60_000, oldest + 60 * 60_000 - now);
    this.#suppressedTimer = this.#later(delay, async () => {
      this.#suppressedTimer = undefined;
      const suppressed = this.#suppressed;
      this.#suppressed = 0;
      if (suppressed === 0) return;
      const title = `${suppressed} notification${suppressed === 1 ? "" : "s"} suppressed`;
      const logId = await this.#log.create({
        event: "notify.suppressed",
        category: "system",
        channel: this.#channel.id,
        dedupeKey: `suppressed:${this.#now()}`,
        title,
        url: "/settings",
        priority: 0,
        status: "queued",
      });
      const settings = await this.getSettings();
      this.#enqueue({
        logIds: [logId],
        attempts: 0,
        unthrottled: true,
        message: {
          title,
          message: "Too many notifications in a short time. See Settings → Notifications.",
          ...this.#link("/settings", "Open settings"),
          priority: 0,
          device: settings.device || undefined,
        },
      });
    });
  }

  // ── Delivery ──────────────────────────────────────────────────────────

  #enqueue(delivery: Delivery): void {
    this.#queue.push(delivery);
    this.#pump();
  }

  #pump(): void {
    while (!this.#stopped && this.#active < MAX_CONCURRENT && this.#queue.length > 0) {
      const delivery = this.#queue.shift()!;
      this.#active += 1;
      void this.#deliver(delivery)
        .catch((error: unknown) => logger.warn({ error }, "notification.failed"))
        .finally(() => {
          this.#active -= 1;
          this.#pump();
        });
    }
  }

  async #deliver(delivery: Delivery): Promise<void> {
    delivery.attempts += 1;
    const result = await this.#send(delivery.message);
    if (result.ok) {
      this.#onSent(result);
      await this.#log.update(delivery.logIds, {
        status: "sent",
        reason: null,
        providerId: result.providerId,
        attempts: delivery.attempts,
        sentAt: new Date(this.#now()),
      });
      logger.info(
        { attempts: delivery.attempts, providerId: result.providerId },
        "notification.sent",
      );
      return;
    }
    if (result.retryable && delivery.attempts <= this.#retryDelays.length) {
      await this.#log.update(delivery.logIds, {
        attempts: delivery.attempts,
        reason: result.reason,
      });
      const base = this.#retryDelays[delivery.attempts - 1];
      // ±20% jitter so retries of a burst spread out.
      const delay = Math.round(base * (0.8 + this.#random() * 0.4));
      this.#later(delay, async () => this.#enqueue(delivery));
      return;
    }
    this.#onFailed(result);
    await this.#log.update(delivery.logIds, {
      status: "failed",
      reason: result.reason,
      attempts: delivery.attempts,
    });
    logger.warn(
      { reason: result.reason, detail: result.detail, attempts: delivery.attempts },
      "notification.failed",
    );
  }

  async #send(message: OutgoingMessage): Promise<SendResult> {
    try {
      return await this.#channel.send(message);
    } catch (error) {
      return { ok: false, retryable: true, reason: "transient", detail: (error as Error).name };
    }
  }

  #onSent(result: Extract<SendResult, { ok: true }>): void {
    if (this.#state !== "connected") this.#state = "connected";
    if (!result.quota) return;
    this.#quota = result.quota;
    const { limit, remaining } = result.quota;
    if (limit <= 0) return;
    if (remaining / limit >= QUOTA_WARN_SHARE) {
      this.#quotaWarned = false;
      return;
    }
    if (this.#quotaWarned) return;
    this.#quotaWarned = true;
    this.notify({
      event: "notify.quota_low",
      category: "system",
      title: "Pushover quota running low",
      message: `${remaining} of ${limit} messages left this month.`,
      path: "/settings",
      urlTitle: "Open settings",
      priority: 0,
      dedupeKey: `quota-low:${result.quota.reset.toISOString()}`,
    });
  }

  #onFailed(result: Extract<SendResult, { ok: false }>): void {
    this.#lastError = {
      reason: result.reason,
      detail: result.detail,
      at: new Date(this.#now()).toISOString(),
    };
    if (result.reason === "invalid_credentials") this.#state = "invalid_credentials";
    if (result.reason === "over_quota") {
      this.#state = "over_quota";
      this.#overQuotaUntil = (result.resetAt ?? nextQuotaReset(this.#now())).getTime();
    }
  }

  // ── Status, validation, test ──────────────────────────────────────────

  status(): NotificationStatus {
    const configured = this.#channel.configured();
    return {
      channel: this.#channel.id,
      state: configured ? this.#state : "not_configured",
      requiredEnv: this.#requiredEnv,
      devices: this.#devices,
      ...(this.#quota
        ? {
            quota: {
              limit: this.#quota.limit,
              remaining: this.#quota.remaining,
              reset: this.#quota.reset.toISOString(),
            },
          }
        : {}),
      ...(this.#lastError ? { lastError: this.#lastError } : {}),
      ...(this.#checkedAt ? { checkedAt: this.#checkedAt.toISOString() } : {}),
    };
  }

  /** Check the credentials (and device) with the provider; refreshes the quota. */
  async validate(): Promise<NotificationStatus> {
    if (!this.#channel.configured()) {
      this.#state = "not_configured";
      return this.status();
    }
    const settings = await this.getSettings();
    const result = await this.#channel.validate(settings.device || undefined);
    this.#checkedAt = new Date(this.#now());
    if (result.ok) {
      this.#state = this.#overQuotaUntil > this.#now() ? "over_quota" : "connected";
      this.#devices = result.devices;
      this.#lastError = undefined;
    } else {
      this.#lastError = {
        reason: result.reason,
        detail: result.detail,
        at: this.#checkedAt.toISOString(),
      };
      this.#state = result.reason === "invalid_credentials" ? "invalid_credentials" : "unknown";
    }
    const quota = await this.#channel.quota().catch(() => undefined);
    if (quota) this.#quota = quota;
    return this.status();
  }

  /** Send a test notification now, bypassing settings and throttling. */
  async sendTest(): Promise<TestResult> {
    if (!this.#channel.configured()) {
      this.#state = "not_configured";
      return { ok: false, reason: "not_configured" };
    }
    const now = this.#now();
    if (now - this.#lastTestAt < TEST_INTERVAL_MS) {
      throw Boom.tooManyRequests("Wait a few seconds before sending another test");
    }
    this.#lastTestAt = now;
    const settings = await this.getSettings();
    const title = "Test notification";
    const logId = await this.#log.create({
      event: "notify.test",
      category: "system",
      channel: this.#channel.id,
      dedupeKey: `test:${now}`,
      title,
      url: "/settings",
      priority: 0,
      status: "queued",
    });
    const result = await this.#send({
      title,
      message: "Notifications are working.",
      ...this.#link("/settings", "Open settings"),
      priority: 0,
      device: settings.device || undefined,
    });
    if (result.ok) {
      this.#onSent(result);
      await this.#log.update([logId], {
        status: "sent",
        providerId: result.providerId,
        attempts: 1,
        sentAt: new Date(this.#now()),
      });
      return { ok: true, providerId: result.providerId };
    }
    this.#onFailed(result);
    await this.#log.update([logId], { status: "failed", reason: result.reason, attempts: 1 });
    return { ok: false, reason: result.reason, detail: result.detail };
  }

  recent(limit = 50) {
    return this.#log.list(Math.min(Math.max(limit, 1), 200));
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────

  /** Validate in the background and prune old log rows daily. */
  start(): void {
    this.#stopped = false;
    if (this.#channel.configured()) {
      void this.validate().catch((error: unknown) =>
        logger.warn({ error }, "Notification channel validation failed"),
      );
    } else {
      this.#state = "not_configured";
    }
    const prune = () =>
      void this.#log
        .prune(new Date(this.#now() - LOG_RETENTION_MS))
        .catch((error: unknown) => logger.warn({ error }, "Notification log prune failed"));
    prune();
    this.#pruneTimer = setInterval(prune, PRUNE_INTERVAL_MS);
    this.#pruneTimer.unref?.();
  }

  /** Clear timers; pending sends are dropped. */
  stop(): void {
    this.#stopped = true;
    for (const timer of this.#timers) clearTimeout(timer);
    this.#timers.clear();
    if (this.#pruneTimer) clearInterval(this.#pruneTimer);
    this.#buckets.clear();
    this.#held = [];
    this.#heldTimer = undefined;
    this.#suppressedTimer = undefined;
    this.#queue.length = 0;
  }

  #later(delayMs: number, run: () => Promise<void>): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => {
      this.#timers.delete(timer);
      if (this.#stopped) return;
      void run().catch((error: unknown) => logger.warn({ error }, "notification.failed"));
    }, delayMs);
    timer.unref?.();
    this.#timers.add(timer);
    return timer;
  }

  #forgetOld(now: number): void {
    for (const [key, at] of this.#recent) {
      if (now - at >= DEFAULT_DEDUPE_SECONDS * 1000) this.#recent.delete(key);
    }
    for (const [key, at] of this.#cancelled) {
      if (now - at >= 60 * 60_000) this.#cancelled.delete(key);
    }
  }
}

/** The app's notification service: Pushover with credentials from the environment. */
export const notificationService = new NotificationService({
  channel: createPushoverChannel({
    token: () => env.PUSHOVER_API_TOKEN,
    user: () => env.PUSHOVER_USER_KEY,
  }),
  log: createDbLogStore(),
  settings: createKvSettingsStore(),
  origin: () => env.ORIGIN,
  requiredEnv: ["PUSHOVER_API_TOKEN", "PUSHOVER_USER_KEY"],
});
