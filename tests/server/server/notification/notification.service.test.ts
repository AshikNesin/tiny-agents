/**
 * The notification pipeline with a fake channel, an in-memory log and fake
 * timers: per-event switches, dedupe (also across a restart), coalescing and
 * cancel-on-resolve, throttling with one summary, quiet hours, retries and
 * the channel states that stop sending.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createMemoryLogStore } from "@groot/core/notification/notification.log";
import {
  NotificationHub,
  NotificationService,
  type NotificationServiceOptions,
} from "@groot/core/notification/notification.service";
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  type NotificationSettings,
} from "@groot/core/notification/notification.settings";
import type {
  Notification,
  NotificationChannel,
  OutgoingMessage,
  SendResult,
} from "@groot/core/notification/notifier";

vi.mock("@groot/core/logger", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

type Responder = (message: OutgoingMessage) => SendResult | Promise<SendResult>;

function fakeChannel(
  respond: Responder = () => ({ ok: true, providerId: "req" }),
  id = "pushover",
) {
  const sent: OutgoingMessage[] = [];
  const dismissed: string[] = [];
  const channel: NotificationChannel & {
    sent: OutgoingMessage[];
    dismissed: string[];
    configuredFlag: boolean;
  } = {
    id,
    sent,
    dismissed,
    configuredFlag: true,
    configured() {
      return this.configuredFlag;
    },
    validate: vi.fn(async () => ({ ok: true as const, devices: ["iphone"] })),
    quota: vi.fn(async () => undefined),
    send: vi.fn(async (message: OutgoingMessage) => {
      sent.push(message);
      return respond(message);
    }),
    dismiss: async (tag: string) => {
      dismissed.push(tag);
    },
  };
  return channel;
}

function settingsStore(initial: Partial<NotificationSettings> = {}) {
  let value: NotificationSettings = { ...DEFAULT_NOTIFICATION_SETTINGS, ...initial };
  return {
    load: async () => value,
    save: async (next: NotificationSettings) => {
      value = next;
      return value;
    },
  };
}

function build(options: Partial<NotificationServiceOptions> = {}) {
  const channel = (options.channel as ReturnType<typeof fakeChannel>) ?? fakeChannel();
  const log = (options.log as ReturnType<typeof createMemoryLogStore>) ?? createMemoryLogStore();
  const service = new NotificationService({
    channel,
    log,
    settings: options.settings ?? settingsStore(),
    origin: options.origin ?? (() => "https://agents.example"),
    now: () => Date.now(),
    random: () => 0.5,
    ...options,
  });
  service.defineEvents([
    {
      event: "approval.requested",
      label: "Approval",
      description: "",
      category: "needs_input",
      defaultEnabled: true,
    },
    {
      event: "routine.succeeded",
      label: "Routine",
      description: "",
      category: "notify",
      defaultEnabled: true,
    },
    {
      event: "peer.reply",
      label: "Peer",
      description: "",
      category: "notify",
      defaultEnabled: false,
    },
    {
      event: "vault.alert",
      label: "Vault",
      description: "",
      category: "security",
      defaultEnabled: true,
      locked: true,
    },
  ]);
  return { service, channel, log };
}

function approval(task: number, extra: Partial<Notification> = {}): Notification {
  return {
    event: "approval.requested",
    category: "needs_input",
    title: `Ops needs approval`,
    message: "Wants to run run_command.",
    path: `/chats/b1?focus=approval:${task}`,
    urlTitle: "Open approval",
    priority: 1,
    dedupeKey: `approval:7:${task}`,
    botId: "b1",
    ...extra,
  };
}

const coalesce: Notification["coalesce"] = {
  key: "needs:7",
  summarize: (batch) => ({ title: `Ops needs you`, message: `${batch.length} approvals waiting` }),
};

const flush = () => vi.advanceTimersByTimeAsync(0);

describe("NotificationService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-29T06:00:00Z")); // 11:30 IST
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns at once and never waits on a hung channel", async () => {
    const channel = fakeChannel(() => new Promise<SendResult>(() => undefined));
    const { service } = build({ channel });
    const started = performance.now();
    service.notify(approval(1));
    expect(performance.now() - started).toBeLessThan(5);
    await flush();
    expect(channel.send).toHaveBeenCalledTimes(1);
  });

  it("does nothing without credentials", async () => {
    const channel = fakeChannel();
    channel.configuredFlag = false;
    const { service, log } = build({ channel });
    service.notify(approval(1));
    await flush();
    expect(channel.send).not.toHaveBeenCalled();
    expect(log.rows).toHaveLength(0);
    expect(service.status().state).toBe("not_configured");
  });

  it("sends a plain, clamped message with an ORIGIN deep link", async () => {
    const { service, channel, log } = build();
    service.notify(approval(1, { title: `${"x".repeat(120)}\u0007` }));
    await flush();
    expect(channel.sent[0]).toMatchObject({
      url: "https://agents.example/chats/b1?focus=approval:1",
      urlTitle: "Open approval",
      priority: 1,
    });
    expect([...channel.sent[0].title]).toHaveLength(80);
    expect(channel.sent[0].title).not.toContain("\u0007");
    expect(log.rows[0]).toMatchObject({
      status: "sent",
      providerId: "req",
      url: "/chats/b1?focus=approval:1",
    });
  });

  it("sends no link without ORIGIN", async () => {
    const { service, channel } = build({ origin: () => undefined });
    service.notify(approval(1));
    await flush();
    expect(channel.sent[0].url).toBeUndefined();
  });

  it("honours per-event switches, but never for locked events", async () => {
    const settings = settingsStore();
    const { service, channel, log } = build({ settings });
    await service.saveSettings({ events: { "approval.requested": false, "vault.alert": false } });
    service.notify(approval(1));
    service.notify({
      ...approval(2),
      event: "peer.reply",
      category: "notify",
      dedupeKey: "peer:1",
    });
    service.notify({
      ...approval(3),
      event: "vault.alert",
      category: "security",
      dedupeKey: "vault:1",
    });
    await flush();
    expect(channel.sent.map((m) => m.title)).toHaveLength(1);
    expect(
      log.rows
        .filter((r) => r.reason === "disabled")
        .map((r) => r.event)
        .sort(),
    ).toEqual(["approval.requested", "peer.reply"]);
    expect((await service.getSettings()).events).toEqual({ "approval.requested": false });
  });

  it("rejects invalid settings", async () => {
    const { service } = build();
    await expect(service.saveSettings({ quietHours: { start: "25:00" } })).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("sends a dedupe key once, also after a restart", async () => {
    const { service, channel, log } = build();
    service.notify(approval(1));
    service.notify(approval(1));
    await flush();
    expect(channel.send).toHaveBeenCalledTimes(1);

    // A new process over the same log (pi-durable re-runs the waiting call).
    const restarted = build({ log });
    restarted.service.notify(approval(1));
    await flush();
    expect(restarted.channel.send).not.toHaveBeenCalled();
  });

  it("coalesces one chat's requests into one push", async () => {
    const { service, channel, log } = build();
    service.notify(approval(1, { coalesce }));
    service.notify(approval(2, { coalesce }));
    service.notify(approval(3, { coalesce }));
    await vi.advanceTimersByTimeAsync(29_000);
    expect(channel.send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(channel.sent).toEqual([
      expect.objectContaining({
        title: "Ops needs you",
        message: "3 approvals waiting",
        priority: 1,
      }),
    ]);
    expect(log.rows.every((row) => row.status === "sent")).toBe(true);
  });

  it("drops a request answered inside the coalescing window", async () => {
    const { service, channel, log } = build();
    service.notify(approval(1, { coalesce }));
    service.notify(approval(2, { coalesce }));
    await flush();
    service.cancel("approval:7:1");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(channel.sent).toEqual([expect.objectContaining({ title: "Ops needs approval" })]);
    expect(log.rows.find((row) => row.dedupeKey === "approval:7:1")?.status).toBe("cancelled");

    service.notify(approval(5, { coalesce }));
    service.cancel("approval:7:5"); // before it was even accepted
    await vi.advanceTimersByTimeAsync(30_000);
    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(log.rows.find((row) => row.dedupeKey === "approval:7:5")?.status).toBe("cancelled");
  });

  it("throttles a looping bot to 5 a minute plus one summary", async () => {
    const { service, channel, log } = build();
    for (let i = 0; i < 100; i++) {
      service.notify({ ...approval(i), event: "routine.succeeded", category: "notify" });
    }
    await flush();
    expect(channel.send).toHaveBeenCalledTimes(5);
    expect(log.rows.filter((row) => row.reason === "throttled")).toHaveLength(95);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(channel.send).toHaveBeenCalledTimes(6);
    expect(channel.sent[5].title).toBe("95 notifications suppressed");
  });

  it("retries transient failures with backoff starting at 5 s", async () => {
    let calls = 0;
    const channel = fakeChannel(() =>
      ++calls < 3
        ? { ok: false, retryable: true, reason: "transient" }
        : { ok: true, providerId: "req-3" },
    );
    const { service, log } = build({ channel });
    service.notify(approval(1));
    await flush();
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toBe(2);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(calls).toBe(3);
    expect(log.rows[0]).toMatchObject({ status: "sent", attempts: 3, providerId: "req-3" });
  });

  it("never retries bad input and stops on bad credentials", async () => {
    let reason: "invalid_input" | "invalid_credentials" = "invalid_input";
    const channel = fakeChannel(() => ({ ok: false, retryable: false, reason, detail: "nope" }));
    const { service, log } = build({ channel });
    service.notify(approval(1));
    await vi.advanceTimersByTimeAsync(20 * 60_000);
    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(log.rows[0]).toMatchObject({ status: "failed", reason: "invalid_input" });

    reason = "invalid_credentials";
    service.notify(approval(2));
    await flush();
    expect(service.status().state).toBe("invalid_credentials");
    service.notify(approval(3));
    await flush();
    expect(channel.send).toHaveBeenCalledTimes(2);
    expect(log.rows.at(-1)).toMatchObject({ status: "suppressed", reason: "invalid_credentials" });
  });

  it("stops at the monthly quota until it resets", async () => {
    const resetAt = new Date("2026-11-01T06:00:00Z");
    const channel = fakeChannel(() => ({
      ok: false,
      retryable: false,
      reason: "over_quota",
      resetAt,
    }));
    const { service, log } = build({ channel });
    service.notify(approval(1));
    await flush();
    expect(service.status().state).toBe("over_quota");
    service.notify(approval(2));
    await flush();
    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(log.rows.at(-1)).toMatchObject({ status: "suppressed", reason: "over_quota" });
  });

  it("warns once when the quota runs low", async () => {
    const quota = { limit: 10_000, remaining: 900, reset: new Date("2026-11-01T06:00:00Z") };
    const channel = fakeChannel(() => ({ ok: true, providerId: "req", quota }));
    const { service } = build({ channel });
    service.notify(approval(1));
    service.notify(approval(2));
    await flush();
    await flush();
    const warnings = channel.sent.filter((m) => m.title === "Pushover quota running low");
    expect(warnings).toHaveLength(1);
  });

  it("holds updates during quiet hours and sends them as one digest", async () => {
    const settings = settingsStore({
      quietHours: {
        enabled: true,
        start: "11:00",
        end: "12:00",
        timezone: "Asia/Kolkata",
        urgentBypass: false,
      },
    });
    const { service, channel } = build({ settings });
    const update = (i: number): Notification => ({
      event: "routine.succeeded",
      category: "notify",
      title: `Routine ${i}`,
      message: "done",
      priority: -1,
      dedupeKey: `routine:${i}`,
    });
    service.notify(update(1));
    service.notify(update(2));
    service.notify(approval(1));
    await flush();
    // Needs-input still arrives, quietly.
    expect(channel.sent).toEqual([
      expect.objectContaining({ title: "Ops needs approval", priority: -1 }),
    ]);
    await vi.advanceTimersByTimeAsync(30 * 60_000); // 12:00 IST
    expect(channel.sent).toHaveLength(2);
    expect(channel.sent[1]).toMatchObject({
      title: "2 updates during quiet hours",
      message: "Routine 1 · Routine 2",
    });
  });

  it("validates credentials and rate-limits test sends", async () => {
    const { service, channel } = build();
    const status = await service.validate();
    expect(status).toMatchObject({ state: "connected", devices: ["iphone"] });
    expect(await service.sendTest()).toEqual({ ok: true, providerId: "req" });
    await expect(service.sendTest()).rejects.toMatchObject({ statusCode: 429 });
    vi.advanceTimersByTime(10_000);
    expect(await service.sendTest()).toMatchObject({ ok: true });
    expect(channel.send).toHaveBeenCalledTimes(2);
  });

  it("hands a channel the tag, event, path and buttons of a single notification", async () => {
    const { service, channel } = build();
    const actions = { kind: "tool" as const, botId: "b1", taskId: 1, tool: "run_command" };
    service.notify(approval(1, { actions }));
    await flush();
    expect(channel.sent[0]).toMatchObject({
      tag: "approval:7:1",
      event: "approval.requested",
      category: "needs_input",
      path: "/chats/b1?focus=approval:1",
      actions,
    });
  });

  it("gives a coalesced summary no buttons and a tag of its own", async () => {
    const { service, channel } = build();
    const actions = { kind: "tool" as const, botId: "b1", taskId: 1, tool: "run_command" };
    service.notify(approval(1, { coalesce, actions }));
    service.notify(approval(2, { coalesce, actions: { ...actions, taskId: 2 } }));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(channel.sent).toHaveLength(1);
    expect(channel.sent[0]!.actions).toBeUndefined();
    expect(channel.sent[0]!.tag).toBe("batch:needs:7");
  });

  it("takes back a sent notification when its request is answered, and only then", async () => {
    const { service, channel } = build();
    service.notify(approval(1));
    await flush();
    expect(channel.sent).toHaveLength(1);
    service.cancel("approval:7:1");
    service.cancel("approval:7:1");
    service.cancel("approval:7:9"); // never sent
    await flush();
    expect(channel.dismissed).toEqual(["approval:7:1"]);
  });

  it("takes back a reminder by the tag it shares with its request", async () => {
    const { service, channel } = build();
    service.notify(approval(1, { dedupeKey: "reminder:approval:7:1", tag: "approval:7:1" }));
    await flush();
    expect(channel.sent[0]!.tag).toBe("approval:7:1");
    service.cancel("approval:7:1");
    await flush();
    expect(channel.dismissed).toEqual(["approval:7:1"]);
  });

  it("drops a queued send answered before it went out, with nothing to take back", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const channel = fakeChannel(async () => {
      await gate;
      return { ok: true, providerId: "req" };
    });
    const { service, log } = build({ channel });
    // Two in flight fill the queue's slots; the third waits.
    service.notify(approval(1));
    service.notify(approval(2));
    service.notify(approval(3));
    await flush();
    expect(channel.send).toHaveBeenCalledTimes(2);
    service.cancel("approval:7:3");
    release();
    await flush();
    expect(channel.send).toHaveBeenCalledTimes(2);
    expect(channel.dismissed).toEqual([]);
    expect(log.rows.find((row) => row.dedupeKey === "approval:7:3")?.status).toBe("cancelled");
  });
});

describe("NotificationHub", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-29T06:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function hubOf(initial: Partial<NotificationSettings> = {}, phoneRegistered = true) {
    const log = createMemoryLogStore();
    const settings = settingsStore(initial);
    const pushover = build({ log, settings });
    const phone = fakeChannel(undefined, "webpush");
    phone.configuredFlag = phoneRegistered;
    const webpush = build({ log, settings, channel: phone });
    const hub = new NotificationHub(pushover.service);
    hub.add(webpush.service);
    return { hub, log, pushover, webpush };
  }

  it("delivers through the one channel the owner chose", async () => {
    const toPushover = hubOf({ deliverTo: "pushover" });
    toPushover.hub.notify(approval(1));
    await flush();
    expect(toPushover.pushover.channel.sent).toHaveLength(1);
    expect(toPushover.webpush.channel.sent).toHaveLength(0);

    const toPhone = hubOf({ deliverTo: "webpush" });
    toPhone.hub.notify(approval(1));
    toPhone.hub.notify(approval(1));
    await flush();
    expect(toPhone.pushover.channel.sent).toHaveLength(0);
    expect(toPhone.webpush.channel.sent).toHaveLength(1);
    expect(toPhone.log.rows.map((row) => [row.channel, row.status])).toEqual([["webpush", "sent"]]);
    toPhone.hub.cancel("approval:7:1");
    await flush();
    expect(toPhone.webpush.channel.dismissed).toEqual(["approval:7:1"]);
  });

  it("sends and logs nothing when notifications are off", async () => {
    const { hub, log, pushover, webpush } = hubOf({ deliverTo: "off" });
    hub.notify(approval(1));
    await flush();
    expect(pushover.channel.send).not.toHaveBeenCalled();
    expect(webpush.channel.send).not.toHaveBeenCalled();
    expect(log.rows).toHaveLength(0);
  });

  it("before a choice, uses the phone app once a phone is registered, else Pushover", async () => {
    const withPhone = hubOf({}, true);
    expect((await withPhone.hub.getSettings()).deliverTo).toBe("webpush");
    withPhone.hub.notify(approval(1));
    await flush();
    expect(withPhone.webpush.channel.sent).toHaveLength(1);
    expect(withPhone.pushover.channel.sent).toHaveLength(0);

    const noPhone = hubOf({}, false);
    expect((await noPhone.hub.getSettings()).deliverTo).toBe("pushover");
    noPhone.hub.notify(approval(1));
    await flush();
    expect(noPhone.pushover.channel.sent).toHaveLength(1);
  });

  it("switches every channel at once when the choice is saved", async () => {
    const { hub, pushover, webpush } = hubOf({ deliverTo: "pushover" });
    await webpush.service.getSettings(); // cache the old value
    await hub.saveSettings({ deliverTo: "webpush" });
    hub.notify(approval(1));
    await flush();
    expect(webpush.channel.sent).toHaveLength(1);
    expect(pushover.channel.send).not.toHaveBeenCalled();
  });
});
