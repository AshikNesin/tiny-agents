import { Hono, type Context } from "hono";
import { z } from "zod";
import type { AppEnv } from "@groot/core/types";
import { ok } from "@groot/core/utils/api-response.utils";
import { parseBody, parseStringParam } from "@groot/core/utils/controller.utils";
import { fromBase64Url } from "@groot/core/utils/encoding.utils";
import { pushTo } from "@groot/core/notification/webpush";
import type {
  PushDeviceListData,
  PushDeviceRegistered,
  PushDeviceRemoved,
  PushDeviceTest,
  VapidKey,
} from "../../../shared/api/push";
import { serverVapidKeys, vapidSubject } from "./push.channel";
import {
  deviceTarget,
  listDevices,
  registerDevice,
  removeDevice,
  reportOutcome,
} from "./push.store";

const router = new Hono<AppEnv>();

const base64urlBytes = (length: number, first?: number) =>
  z
    .string()
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/, "Expected base64url")
    .refine((value) => {
      const bytes = fromBase64Url(value);
      return bytes.length === length && (first === undefined || bytes[0] === first);
    }, `Expected ${length} bytes`);

const deviceSchema = z.object({
  endpoint: z.string().min(1).max(2048),
  keys: z.object({
    p256dh: base64urlBytes(65, 4),
    auth: base64urlBytes(16),
  }),
  distributor: z.enum(["fcm", "unifiedpush", "browser"]),
  label: z.string().trim().max(80).optional(),
  appVersion: z.string().trim().max(40).optional(),
});

const userIdOf = (c: Context<AppEnv>) => c.get("viewer").userId;

router.get("/notifications/vapid-key", async (c) => {
  const keys = await serverVapidKeys();
  return ok(c, { publicKey: keys.publicKey } satisfies VapidKey);
});

router.post("/notifications/devices", async (c) => {
  const body = await parseBody(c, deviceSchema);
  const id = await registerDevice(userIdOf(c), body);
  return ok(c, { id } satisfies PushDeviceRegistered);
});

router.get("/notifications/devices", async (c) =>
  ok(c, { devices: await listDevices(userIdOf(c)) } satisfies PushDeviceListData),
);

router.delete("/notifications/devices/:id", async (c) => {
  await removeDevice(userIdOf(c), parseStringParam(c.req.param("id"), "id"));
  return ok(c, { removed: true } satisfies PushDeviceRemoved);
});

router.post("/notifications/devices/:id/test", async (c) => {
  const target = await deviceTarget(userIdOf(c), parseStringParam(c.req.param("id"), "id"));
  const outcome = await pushTo(
    target,
    {
      payload: {
        v: 1,
        kind: "show",
        tag: `test:${target.id}`,
        event: "notify.test",
        category: "system",
        title: "Test notification",
        message: "Notifications from this server reach this device.",
        path: "/settings",
        priority: 0,
      },
      urgency: "normal",
      ttlSeconds: 60 * 60,
    },
    { keys: await serverVapidKeys(), subject: vapidSubject },
  );
  await reportOutcome(target.id, outcome);
  const result: PushDeviceTest =
    outcome.kind === "sent" ? { ok: true } : { ok: false, reason: outcome.detail };
  return ok(c, result);
});

export default router;
