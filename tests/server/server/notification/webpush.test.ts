import { createDecipheriv, createECDH, hkdfSync } from "node:crypto";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  createWebPushChannel,
  type PushOutcome,
  type StoredPushTarget,
} from "@groot/core/notification/webpush";
import { generateVapidKeys } from "@groot/core/notification/webpush.crypto";
import type { OutgoingMessage } from "@groot/core/notification/notifier";

function device(id: string, endpoint: string) {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const target: StoredPushTarget = {
    id,
    endpoint,
    p256dh: ecdh.getPublicKey().toString("base64url"),
    auth: Buffer.from(auth).toString("base64url"),
  };
  const decrypt = (body: Uint8Array): unknown => {
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
  };
  return { target, decrypt };
}

async function setup(statuses: Record<string, number>) {
  const phone = device("d1", "https://fcm.googleapis.com/fcm/send/abc");
  const ntfy = device("d2", "https://ntfy.example.com/up123");
  const keys = await generateVapidKeys();
  const reports: [string, PushOutcome][] = [];
  const requests: { url: string; init: RequestInit }[] = [];
  const fetchFake = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init: init! });
    return new Response(null, { status: statuses[String(url)] ?? 201 });
  });
  const channel = createWebPushChannel({
    store: {
      hasActive: () => true,
      targets: async () => [phone.target, ntfy.target],
      report: async (id, outcome) => {
        reports.push([id, outcome]);
      },
    },
    keys: async () => keys,
    subject: () => "https://agents.example.com",
    fetch: fetchFake as typeof fetch,
  });
  return { channel, phone, ntfy, reports, requests };
}

const message: OutgoingMessage = {
  title: "✋ Ops needs approval",
  message: "Wants to run run_command. Open the chat to approve or deny.",
  url: "https://agents.example.com/chats/b1?focus=approval:4",
  priority: 1,
  ttlSeconds: 600,
  id: "log-1",
  tag: "approval:7:4",
  event: "approval.requested",
  category: "needs_input",
  path: "/chats/b1?focus=approval:4",
  actions: { kind: "tool", botId: "b1", taskId: 4, tool: "run_command" },
};

describe("the Web Push channel", () => {
  it("sends every device an encrypted payload with urgency, TTL, topic and VAPID", async () => {
    const { channel, phone, ntfy, requests } = await setup({});
    expect(await channel.send(message)).toEqual({ ok: true, providerId: "2/2" });
    expect(requests.map((r) => r.url).sort()).toEqual([
      phone.target.endpoint,
      ntfy.target.endpoint,
    ]);
    const first = requests.find((r) => r.url === phone.target.endpoint);
    const headers = first!.init.headers as Record<string, string>;
    expect(headers).toMatchObject({
      "Content-Encoding": "aes128gcm",
      TTL: "600",
      Urgency: "high",
    });
    expect(headers.Topic).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(headers.Authorization).toMatch(/^vapid t=[^ ]+, k=B[A-Za-z0-9_-]{86}$/);
    expect(first!.init.redirect).toBe("manual");
    expect(phone.decrypt(first!.init.body as Uint8Array)).toEqual({
      v: 1,
      kind: "show",
      id: "log-1",
      tag: "approval:7:4",
      event: "approval.requested",
      category: "needs_input",
      title: "✋ Ops needs approval",
      message: "Wants to run run_command. Open the chat to approve or deny.",
      path: "/chats/b1?focus=approval:4",
      priority: 1,
      actions: { kind: "tool", botId: "b1", taskId: 4, tool: "run_command" },
    });
  });

  it("sends a dismiss under the same topic as the notification it takes back", async () => {
    const { channel, phone, requests } = await setup({});
    await channel.send(message);
    await channel.dismiss!("approval:7:4");
    const toPhone = requests.filter((r) => r.url === phone.target.endpoint);
    const show = toPhone[0]!.init.headers as Record<string, string>;
    const dismiss = toPhone[1]!.init.headers as Record<string, string>;
    expect(dismiss.Topic).toBe(show.Topic);
    expect(phone.decrypt(toPhone[1]!.init.body as Uint8Array)).toEqual({
      v: 1,
      kind: "dismiss",
      tag: "approval:7:4",
    });
  });

  it("reports a gone device and still delivers to the others", async () => {
    const { channel, reports } = await setup({ "https://fcm.googleapis.com/fcm/send/abc": 410 });
    expect(await channel.send(message)).toEqual({ ok: true, providerId: "1/2" });
    expect(reports.sort(([a], [b]) => a.localeCompare(b))).toEqual([
      ["d1", { kind: "gone", detail: "HTTP 410" }],
      ["d2", { kind: "sent" }],
    ]);
  });

  it("asks for a retry when every device failed for a passing reason", async () => {
    const { channel } = await setup({
      "https://fcm.googleapis.com/fcm/send/abc": 503,
      "https://ntfy.example.com/up123": 429,
    });
    expect(await channel.send(message)).toEqual({
      ok: false,
      retryable: true,
      reason: "transient",
      detail: "HTTP 503",
    });
  });

  it("doesn't retry a message every push service refused", async () => {
    const { channel } = await setup({
      "https://fcm.googleapis.com/fcm/send/abc": 413,
      "https://ntfy.example.com/up123": 400,
    });
    expect(await channel.send(message)).toMatchObject({
      ok: false,
      retryable: false,
      reason: "invalid_input",
    });
  });
});
