import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { createNamespaceKv } from "@groot/core/kv";
import { createDbLogStore } from "@groot/core/notification/notification.log";
import { NOTIFICATION_SETTINGS_KEY } from "@groot/core/notification/notification.settings";
import { notificationService } from "@groot/core/notification/notification.service";
import { NOTIFICATION_EVENTS } from "../../../apps/web/src/server/api/notifications/notifications.events";
import { api, createTestApp } from "../helpers";
import { authToken } from "../fixtures";

const kv = createNamespaceKv("APP_SETTING");

const app = createTestApp();
let token: string;
const fetchSpy = vi.spyOn(globalThis, "fetch");

interface SettingsBody {
  settings: Record<string, unknown> & { quietHours: Record<string, unknown> };
  events: { event: string }[];
}

beforeAll(async () => {
  token = await authToken("notifications-test@example.com");
  await kv.delete(NOTIFICATION_SETTINGS_KEY);
  notificationService.defineEvents(NOTIFICATION_EVENTS);
});

afterAll(async () => {
  await kv.delete(NOTIFICATION_SETTINGS_KEY);
  fetchSpy.mockRestore();
});

describe("notifications routes", () => {
  it("require a session", async () => {
    expect((await api(app, "/api/v1/notifications/status")).status).toBe(401);
  });

  it("report the channel as not configured, naming the env vars", async () => {
    const res = await api(app, "/api/v1/notifications/status", { token });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      channel: "pushover",
      state: "not_configured",
      requiredEnv: ["PUSHOVER_API_TOKEN", "PUSHOVER_USER_KEY"],
      devices: [],
    });
  });

  it("send no test without credentials and never call Pushover", async () => {
    const res = await api(app, "/api/v1/notifications/test", { method: "POST", token });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ ok: false, reason: "not_configured" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("read defaults and the app's events", async () => {
    const res = await api<SettingsBody>(app, "/api/v1/notifications/settings", { token });
    expect(res.status).toBe(200);
    expect(res.body.data!.settings).toMatchObject({
      events: {},
      quietHours: { enabled: false, start: "22:00", end: "07:00", timezone: "Asia/Kolkata" },
      longRunMinutes: 5,
      coalesceSeconds: 30,
      reminderMinutes: 15,
    });
    expect(res.body.data!.events.map((e) => e.event)).toEqual(
      expect.arrayContaining(["system.started", "approval.requested", "routine.failed"]),
    );
  });

  it("save valid settings and reject invalid ones", async () => {
    const read = await api<SettingsBody>(app, "/api/v1/notifications/settings", { token });
    expect(read.status).toBe(200);
    const current = read.body.data!.settings;
    const next = {
      ...current,
      events: { "routine.succeeded": false },
      quietHours: { ...current.quietHours, enabled: true, start: "23:00", end: "06:30" },
      device: "iphone",
    };
    const saved = await api<SettingsBody>(app, "/api/v1/notifications/settings", {
      method: "PUT",
      json: next,
      token,
    });
    expect(saved.status).toBe(200);
    expect(saved.body.data!.settings).toEqual(next);
    const stored = await kv.get<{ value: unknown }>(NOTIFICATION_SETTINGS_KEY);
    expect(stored?.value).toEqual(next);

    const badDevice = await api(app, "/api/v1/notifications/settings", {
      method: "PUT",
      json: { ...next, device: "not a device name!" },
      token,
    });
    expect(badDevice.status).toBe(400);
    const badZone = await api(app, "/api/v1/notifications/settings", {
      method: "PUT",
      json: { ...next, quietHours: { ...next.quietHours, timezone: "Mars/Olympus" } },
      token,
    });
    expect(badZone.status).toBe(400);
  });

  it("list the log", async () => {
    const res = await api(app, "/api/v1/notifications/log?limit=5", { token });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect((await api(app, "/api/v1/notifications/log?limit=0", { token })).status).toBe(400);
  });

  it("keep the log in the database: newest first, dedupe lookups, updates and pruning", async () => {
    const store = createDbLogStore();
    const row = {
      event: "routine.failed",
      category: "notify",
      channel: "pushover",
      title: "Digest failed",
      priority: 0,
    };
    const first = await store.create({ ...row, dedupeKey: "k1", status: "queued" });
    await new Promise((r) => setTimeout(r, 5));
    const second = await store.create({
      ...row,
      dedupeKey: "k2",
      status: "suppressed",
      reason: "disabled",
      url: "/routines",
    });

    const res = await api<{ id: string; status: string; url: string | null }[]>(
      app,
      "/api/v1/notifications/log?limit=5",
      { token },
    );
    expect(res.body.data!.map((r) => r.id)).toEqual([second, first]);
    expect(res.body.data![0]).toMatchObject({ status: "suppressed", url: "/routines" });

    const since = new Date(Date.now() - 60_000);
    expect(await store.hasRecent("k1", since)).toBe(true);
    expect(await store.hasRecent("k2", since)).toBe(false);
    expect(await store.hasRecent("k1", new Date(Date.now() + 60_000))).toBe(false);

    const sentAt = new Date();
    await store.update([first], { status: "sent", providerId: "req-1", attempts: 1, sentAt });
    await store.update([], { status: "failed" });
    expect((await store.list(1)).map((r) => r.id)).toEqual([second]);
    const sent = (await store.list(5)).find((r) => r.id === first)!;
    expect(sent).toMatchObject({ status: "sent", providerId: "req-1", attempts: 1 });
    expect(sent.sentAt?.getTime()).toBe(sentAt.getTime());

    expect(await store.prune(new Date(Date.now() + 1000))).toBe(2);
    expect(await store.list(5)).toEqual([]);
  });
});
