/**
 * Notification settings API without Pushover credentials (the test env sets
 * none): status says what to configure, the test send reports it instead of
 * calling out, settings round-trip with defaults and validation, and every
 * route needs a session.
 */
import express, { type Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { errorHandlerMiddleware } from "@groot/core/middlewares/error-handler.middleware";
import { generateToken } from "@groot/core/utils/jwt.utils";
import { createNamespaceKv } from "@groot/core/kv";
import { NOTIFICATION_SETTINGS_KEY } from "@groot/core/notification/notification.settings";
import { notificationService } from "@groot/core/notification/notification.service";
import { NOTIFICATION_EVENTS } from "../../../apps/web/src/server/api/notifications/notifications.events";
import { registerRoutes } from "../../../apps/web/src/server/routes";

const token = generateToken({ userId: 1, email: "notifications-test@example.com" });
const authorization = { Authorization: `Bearer ${token}` };
const kv = createNamespaceKv("APP_SETTING");

let app: Express;
const fetchSpy = vi.spyOn(globalThis, "fetch");

beforeAll(async () => {
  await kv.delete(NOTIFICATION_SETTINGS_KEY);
  notificationService.defineEvents(NOTIFICATION_EVENTS);
  app = express();
  app.use(express.json());
  registerRoutes(app);
  app.use(errorHandlerMiddleware);
});

afterAll(async () => {
  await kv.delete(NOTIFICATION_SETTINGS_KEY);
  fetchSpy.mockRestore();
});

describe("notifications routes", () => {
  it("require a session", async () => {
    await request(app).get("/api/v1/notifications/status").expect(401);
  });

  it("report the channel as not configured, naming the env vars", async () => {
    const res = await request(app)
      .get("/api/v1/notifications/status")
      .set(authorization)
      .expect(200);
    expect(res.body.data).toMatchObject({
      channel: "pushover",
      state: "not_configured",
      requiredEnv: ["PUSHOVER_API_TOKEN", "PUSHOVER_USER_KEY"],
      devices: [],
    });
  });

  it("send no test without credentials and never call Pushover", async () => {
    const res = await request(app)
      .post("/api/v1/notifications/test")
      .set(authorization)
      .expect(200);
    expect(res.body.data).toEqual({ ok: false, reason: "not_configured" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("read defaults and the app's events", async () => {
    const res = await request(app)
      .get("/api/v1/notifications/settings")
      .set(authorization)
      .expect(200);
    expect(res.body.data.settings).toMatchObject({
      events: {},
      quietHours: { enabled: false, start: "22:00", end: "07:00", timezone: "Asia/Kolkata" },
      longRunMinutes: 5,
      coalesceSeconds: 30,
      reminderMinutes: 15,
    });
    expect(res.body.data.events.map((e: { event: string }) => e.event)).toEqual(
      expect.arrayContaining(["system.started", "approval.requested", "routine.failed"]),
    );
  });

  it("save valid settings and reject invalid ones", async () => {
    const current = (
      await request(app).get("/api/v1/notifications/settings").set(authorization).expect(200)
    ).body.data.settings;
    const next = {
      ...current,
      events: { "routine.succeeded": false },
      quietHours: { ...current.quietHours, enabled: true, start: "23:00", end: "06:30" },
      device: "iphone",
    };
    const saved = await request(app)
      .put("/api/v1/notifications/settings")
      .set(authorization)
      .send(next)
      .expect(200);
    expect(saved.body.data.settings).toEqual(next);
    const stored = await kv.get<{ value: unknown }>(NOTIFICATION_SETTINGS_KEY);
    expect(stored?.value).toEqual(next);

    await request(app)
      .put("/api/v1/notifications/settings")
      .set(authorization)
      .send({ ...next, device: "not a device name!" })
      .expect(400);
    await request(app)
      .put("/api/v1/notifications/settings")
      .set(authorization)
      .send({ ...next, quietHours: { ...next.quietHours, timezone: "Mars/Olympus" } })
      .expect(400);
  });

  it("list the log", async () => {
    const res = await request(app)
      .get("/api/v1/notifications/log?limit=5")
      .set(authorization)
      .expect(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    await request(app).get("/api/v1/notifications/log?limit=0").set(authorization).expect(400);
  });
});
