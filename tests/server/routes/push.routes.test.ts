/**
 * Phone push devices (issue #306) through the real routes and database, with
 * only DNS and the push service faked: the owner registers, lists, tests and
 * removes devices; endpoints that would reach the server's own network are
 * refused; guests get nothing; and an answered approval is taken back from
 * the phone.
 */
import { createDecipheriv, createECDH, hkdfSync } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";
import {
  NotificationHub,
  NotificationService,
} from "@groot/core/notification/notification.service";
import { createMemoryLogStore } from "@groot/core/notification/notification.log";
import { DEFAULT_NOTIFICATION_SETTINGS } from "@groot/core/notification/notification.settings";
import { createPushoverChannel } from "@groot/core/notification/pushover";
import { db, guests, pushSubscriptions } from "../../../apps/web/src/server/db";
import { attachWebPush } from "../../../apps/web/src/server/api/notifications/push.channel";
import { clearVapidKeysForTests } from "../../../apps/web/src/server/api/notifications/push.vapid";
import { approvalRequested } from "../../../apps/web/src/server/api/notifications/notifications.events";
import { api, createTestApp } from "../helpers";
import { authToken } from "../fixtures";
import { eventually } from "../fixtures/until";

const lookup = vi.hoisted(() => vi.fn());
vi.mock("node:dns/promises", () => ({ lookup, default: { lookup } }));

const app = createTestApp();
const fetchSpy = vi.spyOn(globalThis, "fetch");
let owner: string;
let guest: string;

function phone(endpoint = "https://fcm.googleapis.com/fcm/send/abc:123") {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return {
    body: {
      endpoint,
      keys: {
        p256dh: ecdh.getPublicKey().toString("base64url"),
        auth: Buffer.from(auth).toString("base64url"),
      },
      distributor: "fcm",
      label: "Pixel 8",
      appVersion: "0.6.0",
    },
    decrypt(body: Uint8Array): unknown {
      const buf = Buffer.from(body);
      const salt = buf.subarray(0, 16);
      const asPublic = buf.subarray(21, 21 + buf[20]!);
      const ciphertext = buf.subarray(21 + buf[20]!);
      const info = Buffer.concat([Buffer.from("WebPush: info\0"), ecdh.getPublicKey(), asPublic]);
      const ikm = Buffer.from(hkdfSync("sha256", ecdh.computeSecret(asPublic), auth, info, 32));
      const cek = Buffer.from(hkdfSync("sha256", ikm, salt, "Content-Encoding: aes128gcm\0", 16));
      const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, "Content-Encoding: nonce\0", 12));
      const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
      decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
      const plain = Buffer.concat([
        decipher.update(ciphertext.subarray(0, ciphertext.length - 16)),
        decipher.final(),
      ]);
      return JSON.parse(plain.subarray(0, plain.length - 1).toString("utf8"));
    },
  };
}

const pushedTo = (endpoint: string) =>
  fetchSpy.mock.calls.filter(([url]) => String(url) === endpoint).map(([, init]) => init!);

beforeAll(async () => {
  owner = await authToken("push-owner@example.com", 1);
  guest = await authToken("push-guest@example.com", 5151);
  await db.insert(guests).values({ userId: 5151 }).onConflictDoNothing();
});

beforeEach(async () => {
  await db.delete(pushSubscriptions);
  await clearVapidKeysForTests();
  lookup.mockReset();
  lookup.mockResolvedValue([{ address: "142.250.70.42", family: 4 }]);
  fetchSpy.mockReset();
  fetchSpy.mockResolvedValue(new Response(null, { status: 201 }));
});

afterAll(async () => {
  await db.delete(pushSubscriptions);
  await db.delete(guests);
  fetchSpy.mockRestore();
});

describe("push device routes", () => {
  it("need a session, and are the owner's only", async () => {
    expect((await api(app, "/api/v1/notifications/vapid-key")).status).toBe(401);
    expect((await api(app, "/api/v1/notifications/vapid-key", { token: guest })).status).toBe(403);
    const res = await api(app, "/api/v1/notifications/devices", {
      method: "POST",
      token: guest,
      json: phone().body,
    });
    expect(res.status).toBe(403);
  });

  it("give one public key, the same on every call", async () => {
    const first = await api<{ publicKey: string }>(app, "/api/v1/notifications/vapid-key", {
      token: owner,
    });
    const second = await api<{ publicKey: string }>(app, "/api/v1/notifications/vapid-key", {
      token: owner,
    });
    expect(first.status).toBe(200);
    expect(Buffer.from(first.body.data!.publicKey, "base64url")).toHaveLength(65);
    expect(second.body.data!.publicKey).toBe(first.body.data!.publicKey);
  });

  it("register a device once per endpoint and list it without its keys", async () => {
    const device = phone();
    const first = await api<{ id: string }>(app, "/api/v1/notifications/devices", {
      method: "POST",
      token: owner,
      json: device.body,
    });
    const again = await api<{ id: string }>(app, "/api/v1/notifications/devices", {
      method: "POST",
      token: owner,
      json: { ...device.body, label: "Pixel 8 Pro" },
    });
    expect(first.status).toBe(200);
    expect(again.body.data!.id).toBe(first.body.data!.id);
    const list = await api<{ devices: Record<string, unknown>[] }>(
      app,
      "/api/v1/notifications/devices",
      { token: owner },
    );
    expect(list.body.data!.devices).toEqual([
      expect.objectContaining({
        id: first.body.data!.id,
        label: "Pixel 8 Pro",
        distributor: "fcm",
        host: "fcm.googleapis.com",
        status: "active",
      }),
    ]);
    expect(JSON.stringify(list.body.data)).not.toContain(device.body.keys.auth);
    expect(JSON.stringify(list.body.data)).not.toContain("abc:123");
  });

  it("refuse endpoints that aren't https or that reach a private address", async () => {
    const post = (endpoint: string) =>
      api(app, "/api/v1/notifications/devices", {
        method: "POST",
        token: owner,
        json: phone(endpoint).body,
      });
    expect((await post("http://ntfy.example.com/up1")).status).toBe(400);
    expect((await post("https://127.0.0.1/up1")).status).toBe(400);
    expect((await post("https://ntfy.local/up1")).status).toBe(400);
    lookup.mockResolvedValueOnce([{ address: "192.168.1.20", family: 4 }]);
    expect((await post("https://ntfy.example.com/up1")).status).toBe(400);
    expect(await db.select().from(pushSubscriptions)).toEqual([]);
  });

  it("refuse keys that aren't a P-256 point and a 16-byte secret", async () => {
    const device = phone();
    const res = await api(app, "/api/v1/notifications/devices", {
      method: "POST",
      token: owner,
      json: {
        ...device.body,
        keys: { p256dh: device.body.keys.auth, auth: device.body.keys.auth },
      },
    });
    expect(res.status).toBe(400);
  });

  it("send a test the device can read, and remove the device", async () => {
    const device = phone();
    const { body } = await api<{ id: string }>(app, "/api/v1/notifications/devices", {
      method: "POST",
      token: owner,
      json: device.body,
    });
    const id = body.data!.id;
    const test = await api(app, `/api/v1/notifications/devices/${id}/test`, {
      method: "POST",
      token: owner,
    });
    expect(test.body.data).toEqual({ ok: true });
    const [init] = pushedTo(device.body.endpoint);
    expect(device.decrypt(init!.body as Uint8Array)).toMatchObject({
      kind: "show",
      title: "Test notification",
      path: "/settings",
    });
    const removed = await api(app, `/api/v1/notifications/devices/${id}`, {
      method: "DELETE",
      token: owner,
    });
    expect(removed.status).toBe(200);
    const gone = await api(app, `/api/v1/notifications/devices/${id}`, {
      method: "DELETE",
      token: owner,
    });
    expect(gone.status).toBe(404);
  });

  it("revoke a device its push service forgot", async () => {
    const device = phone();
    const { body } = await api<{ id: string }>(app, "/api/v1/notifications/devices", {
      method: "POST",
      token: owner,
      json: device.body,
    });
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 410 }));
    const test = await api(app, `/api/v1/notifications/devices/${body.data!.id}/test`, {
      method: "POST",
      token: owner,
    });
    expect(test.body.data).toEqual({ ok: false, reason: "HTTP 410" });
    const [row] = await db.select().from(pushSubscriptions);
    expect(row).toMatchObject({ status: "revoked", lastError: "HTTP 410" });
  });
});

describe("approvals on a registered phone", () => {
  let hub: NotificationHub;
  let detach: () => void;

  beforeEach(() => {
    const settings = {
      load: async () => DEFAULT_NOTIFICATION_SETTINGS,
      save: async () => DEFAULT_NOTIFICATION_SETTINGS,
    };
    hub = new NotificationHub(
      new NotificationService({
        channel: createPushoverChannel({ token: () => undefined, user: () => undefined }),
        log: createMemoryLogStore(),
        settings,
        origin: () => undefined,
      }),
    );
    detach = attachWebPush(hub);
  });

  afterEach(() => detach());

  it("arrive with their buttons and are taken back when answered", async () => {
    const device = phone();
    await api(app, "/api/v1/notifications/devices", {
      method: "POST",
      token: owner,
      json: device.body,
    });
    const bot = { id: "b1", name: "Ops", conversationId: 7 };
    hub.notify({
      ...approvalRequested(bot, 4, "run_command", {
        actions: { kind: "tool", botId: "b1", taskId: 4, tool: "run_command" },
      }),
      coalesce: undefined,
    });
    await eventually(() => expect(pushedTo(device.body.endpoint)).toHaveLength(1));
    expect(device.decrypt(pushedTo(device.body.endpoint)[0]!.body as Uint8Array)).toMatchObject({
      kind: "show",
      tag: "approval:7:4",
      event: "approval.requested",
      title: "✋ Ops needs approval",
      path: "/chats/b1?focus=approval%3A4",
      actions: { kind: "tool", botId: "b1", taskId: 4, tool: "run_command" },
    });
    hub.cancel("approval:7:4");
    await eventually(() => expect(pushedTo(device.body.endpoint)).toHaveLength(2));
    expect(device.decrypt(pushedTo(device.body.endpoint)[1]!.body as Uint8Array)).toEqual({
      v: 1,
      kind: "dismiss",
      tag: "approval:7:4",
    });
  });
});
