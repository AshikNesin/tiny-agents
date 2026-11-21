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
  origin: () => string | undefined;
  requiredEnv?: string[];
  now?: () => number;
  retryDelaysMs?: readonly number[];
  random?: () => number;
}

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

interface Accepted {
  n: Notification;
  logId: string;
  priority: NotificationPriority;
  acceptedAt: number;
}

interface Delivery {
  logIds: string[];
  tag?: string;
  message: OutgoingMessage;
  botId?: string;
  attempts: number;
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
  #delivers: (settings: NotificationSettings) => boolean = () => true;

  readonly #recent = new Map<string, number>();
  readonly #cancelled = new Map<string, number>();
  readonly #dispatched = new Map<string, number>();
  readonly #buckets = new Map<string, Bucket>();
  #held: Accepted[] = [];
  #heldTimer: ReturnType<typeof setTimeout> | undefined;
  readonly #queue: Delivery[] = [];
  #active = 0;
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

  primeSettings(value: NotificationSettings): void {
    this.#settingsCache = { value, at: this.#now() };
  }

  get channelId(): string {
    return this.#channel.id;
  }

  get configured(): boolean {
    return this.#channel.configured();
  }

  routeBy(delivers: (settings: NotificationSettings) => boolean): void {
    this.#delivers = delivers;
  }

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
    let dropped = false;
    for (let i = this.#queue.length - 1; i >= 0; i--) {
      const delivery = this.#queue[i]!;
      if (delivery.tag !== dedupeKey) continue;
      this.#queue.splice(i, 1);
      cancelled.push(...delivery.logIds);
      dropped = true;
    }
    if (cancelled.length > 0) {
      void this.#log
        .update(cancelled, { status: "cancelled" })
        .catch((error: unknown) => logger.warn({ error }, "notification log update failed"));
    }
    if (this.#dispatched.delete(dedupeKey) && !dropped && this.#channel.dismiss) {
      void this.#channel
        .dismiss(dedupeKey)
        .catch((error: unknown) => logger.warn({ error }, "notification dismiss failed"));
    }
  }

  async #accept(n: Notification, now: number, windowMs: number): Promise<void> {
    const settings = await this.getSettings();
    if (!this.#delivers(settings)) return;
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
    if (await this.#log.hasRecent(n.dedupeKey, new Date(now - windowMs), this.#channel.id)) {
      return;
    }

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
    const single = items.length === 1 && !summary;
    const tag = single
      ? (first.n.tag ?? first.n.dedupeKey)
      : summary
        ? `digest:${first.logId}`
        : `batch:${first.n.coalesce?.key ?? first.logId}`;
    if (single) this.#dispatched.set(tag, now);
    this.#enqueue({
      logIds,
      botId,
      attempts: 0,
      ...(single ? { tag } : {}),
      message: {
        title,
        message,
        ...this.#link(path, summary ? undefined : first.n.urlTitle),
        priority: maxPriority(items),
        ttlSeconds,
        device: settings.device || undefined,
        id: first.logId,
        tag,
        event: single ? first.n.event : summary ? "notify.digest" : first.n.event,
        category: first.n.category,
        ...(path ? { path } : {}),
        ...(single && first.n.actions ? { actions: first.n.actions } : {}),
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
      id: logId,
      tag: `test:${now}`,
      event: "notify.test",
      category: "system",
      path: "/settings",
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
    for (const [tag, at] of this.#dispatched) {
      if (now - at >= DEFAULT_DEDUPE_SECONDS * 1000) this.#dispatched.delete(tag);
    }
  }
}

export class NotificationHub {
  readonly primary: NotificationService;
  readonly #services: NotificationService[];

  constructor(primary: NotificationService) {
    this.primary = primary;
    this.#services = [primary];
    this.#route(primary);
  }

  deliveringTo(settings: NotificationSettings): string | null {
    const choice = settings.deliverTo;
    if (choice === "off") return null;
    if (choice !== "auto") return choice;
    const others = this.#services.slice(1);
    const ready = others.find((service) => service.configured);
    if (ready) return ready.channelId;
    return (this.primary.configured ? this.primary : (others[0] ?? this.primary)).channelId;
  }

  #route(service: NotificationService): void {
    service.routeBy((settings) => this.deliveringTo(settings) === service.channelId);
  }

  add(service: NotificationService): () => void {
    for (const def of this.primary.events()) service.defineEvents([def]);
    this.#route(service);
    this.#services.push(service);
    return () => {
      const at = this.#services.indexOf(service);
      if (at > 0) this.#services.splice(at, 1);
    };
  }

  channel(id: string): NotificationService | undefined {
    return this.#services.find((service) => service.channelId === id);
  }

  notify(n: Notification): void {
    for (const service of this.#services) service.notify(n);
  }

  cancel(dedupeKey: string): void {
    for (const service of this.#services) service.cancel(dedupeKey);
  }

  defineEvents(defs: readonly NotificationEventDef[]): void {
    for (const service of this.#services) service.defineEvents(defs);
  }

  events(): NotificationEventDef[] {
    return this.primary.events();
  }

  async getSettings(): Promise<NotificationSettings> {
    return this.#resolved(await this.primary.getSettings());
  }

  async saveSettings(input: unknown): Promise<NotificationSettings> {
    const value = await this.primary.saveSettings(input);
    for (const service of this.#services)
      if (service !== this.primary) service.primeSettings(value);
    return this.#resolved(value);
  }

  #resolved(settings: NotificationSettings): NotificationSettings {
    if (settings.deliverTo !== "auto") return settings;
    const to = this.deliveringTo(settings);
    return { ...settings, deliverTo: to === "webpush" || to === "pushover" ? to : "auto" };
  }

  status(): NotificationStatus {
    return this.primary.status();
  }

  validate(): Promise<NotificationStatus> {
    return this.primary.validate();
  }

  sendTest(): Promise<TestResult> {
    return this.primary.sendTest();
  }

  recent(limit = 50) {
    return this.primary.recent(limit);
  }

  start(): void {
    for (const service of this.#services) service.start();
  }

  stop(): void {
    for (const service of this.#services) service.stop();
  }
}

export const notificationService = new NotificationHub(
  new NotificationService({
    channel: createPushoverChannel({
      token: () => env.PUSHOVER_API_TOKEN,
      user: () => env.PUSHOVER_USER_KEY,
    }),
    log: createDbLogStore(),
    settings: createKvSettingsStore(),
    origin: () => env.ORIGIN,
    requiredEnv: ["PUSHOVER_API_TOKEN", "PUSHOVER_USER_KEY"],
  }),
);
