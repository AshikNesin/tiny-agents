import { afterEach, describe, expect, it } from "vite-plus/test";
import { Hono } from "hono";
import { createApp } from "@groot/core/app";
import { setConfig } from "@groot/core/config";
import { rateLimit } from "@groot/core/middlewares/rate-limit.middleware";
import { ok } from "@groot/core/utils/api-response.utils";
import type { AppEnv } from "@groot/core/types";
import { createTestApp } from "../helpers";

function buildApp() {
  return createApp({
    routes(app) {
      const r = new Hono<AppEnv>();
      r.get(
        "/limited",
        rateLimit({
          window: () => ({ windowMs: 60_000, max: 2 }),
          message: "slow down",
          binding: "TEST_LIMITER",
        }),
        (c) => ok(c, { fine: true }),
      );
      app.route("/api/v1", r);
    },
  });
}

type TestApp = ReturnType<typeof buildApp>;

function fromPeer(app: TestApp, peer: string, forwardedFor?: string, bindings: object = {}) {
  const headers: Record<string, string> = forwardedFor ? { "x-forwarded-for": forwardedFor } : {};
  return app.request(
    "/api/v1/limited",
    { headers },
    { ...bindings, incoming: { socket: { remoteAddress: peer } } },
  );
}

afterEach(() => {
  setConfig();
});

describe("rateLimit middleware", () => {
  it("counts per client within the window and sets standard headers", async () => {
    const app = buildApp();
    const first = await fromPeer(app, "203.0.113.5");
    expect(first.status).toBe(200);
    expect(first.headers.get("RateLimit-Limit")).toBe("2");
    expect(first.headers.get("RateLimit-Remaining")).toBe("1");
    expect((await fromPeer(app, "203.0.113.5")).status).toBe(200);
    const third = await fromPeer(app, "203.0.113.5");
    expect(third.status).toBe(429);
    expect(await third.json()).toMatchObject({
      error: { code: "TOO_MANY_REQUESTS", message: "slow down" },
    });
    expect((await fromPeer(app, "203.0.113.6")).status).toBe(200);
  });

  it("ignores X-Forwarded-For from a public peer under the default trust", async () => {
    const app = buildApp();
    expect((await fromPeer(app, "203.0.113.5", "198.51.100.1")).status).toBe(200);
    expect((await fromPeer(app, "203.0.113.5", "198.51.100.2")).status).toBe(200);
    expect((await fromPeer(app, "203.0.113.5", "198.51.100.3, 10.0.0.1")).status).toBe(429);
  });

  it("gives each client behind a loopback proxy its own bucket under the default trust", async () => {
    const app = buildApp();
    for (let i = 0; i < 2; i++) {
      expect((await fromPeer(app, "127.0.0.1", "198.51.100.1")).status).toBe(200);
    }
    expect((await fromPeer(app, "127.0.0.1", "198.51.100.1")).status).toBe(429);
    expect((await fromPeer(app, "127.0.0.1", "198.51.100.2")).status).toBe(200);
  });

  it("ignores X-Forwarded-For even from loopback when no proxy is trusted", async () => {
    setConfig({ trustedProxies: [] });
    const app = buildApp();
    expect((await fromPeer(app, "127.0.0.1", "198.51.100.1")).status).toBe(200);
    expect((await fromPeer(app, "127.0.0.1", "198.51.100.2")).status).toBe(200);
    expect((await fromPeer(app, "127.0.0.1", "198.51.100.3")).status).toBe(429);
  });

  it("ignores X-Forwarded-For from a peer outside an explicit proxy list", async () => {
    setConfig({ trustedProxies: ["192.0.2.10"] });
    const app = buildApp();
    expect((await fromPeer(app, "10.0.0.2", "198.51.100.1")).status).toBe(200);
    expect((await fromPeer(app, "10.0.0.2", "198.51.100.2")).status).toBe(200);
    expect((await fromPeer(app, "10.0.0.2", "198.51.100.3")).status).toBe(429);
  });

  it("takes the rightmost hop that is not a trusted proxy, so a client cannot prepend its way out", async () => {
    const app = buildApp();
    expect((await fromPeer(app, "10.0.0.2", "1.1.1.1, 198.51.100.7, 10.0.0.3")).status).toBe(200);
    expect((await fromPeer(app, "10.0.0.2", "2.2.2.2, 198.51.100.7")).status).toBe(200);
    expect((await fromPeer(app, "10.0.0.2", "198.51.100.7")).status).toBe(429);
    expect((await fromPeer(app, "10.0.0.2", "198.51.100.7, 198.51.100.8")).status).toBe(200);
  });

  it("matches an IPv4 peer reported in IPv4-mapped IPv6 form", async () => {
    const app = buildApp();
    for (let i = 0; i < 2; i++) {
      expect((await fromPeer(app, "::ffff:10.0.0.2", "198.51.100.1")).status).toBe(200);
    }
    expect((await fromPeer(app, "::ffff:10.0.0.2", "198.51.100.1")).status).toBe(429);
    expect((await fromPeer(app, "::ffff:10.0.0.2", "198.51.100.2")).status).toBe(200);
  });

  it("keys an IPv6 client by its /64, so rotating addresses inside it shares one limit", async () => {
    const app = buildApp();
    expect((await fromPeer(app, "2001:db8:1:2::1")).status).toBe(200);
    expect((await fromPeer(app, "2001:db8:1:2:ffff::2")).status).toBe(200);
    expect((await fromPeer(app, "2001:0db8:0001:0002::3")).status).toBe(429);
    expect((await fromPeer(app, "2001:db8:1:3::1")).status).toBe(200);
  });

  it("keeps the IPv4 key for an IPv4-mapped address in either notation", async () => {
    const app = buildApp();
    expect((await fromPeer(app, "127.0.0.1", "::ffff:c633:6401")).status).toBe(200);
    expect((await fromPeer(app, "127.0.0.1", "198.51.100.1")).status).toBe(200);
    expect((await fromPeer(app, "127.0.0.1", "::ffff:198.51.100.1")).status).toBe(429);
    expect((await fromPeer(app, "127.0.0.1", "::ffff:c633:6402")).status).toBe(200);
  });

  it("trusts a unique-local IPv6 proxy under the default trust", async () => {
    const app = buildApp();
    for (let i = 0; i < 2; i++) {
      expect((await fromPeer(app, "fd00::1", "2001:db8:7::1")).status).toBe(200);
    }
    expect((await fromPeer(app, "fd00::1", "2001:db8:7::1")).status).toBe(429);
    expect((await fromPeer(app, "fd00::1", "2001:db8:8::1")).status).toBe(200);
  });

  it("trusts a proxy inside an IPv6 range in an explicit proxy list", async () => {
    setConfig({ trustedProxies: ["2001:db8:ffff::/48"] });
    const app = buildApp();
    for (let i = 0; i < 2; i++) {
      expect((await fromPeer(app, "2001:db8:ffff:1::5", "198.51.100.1")).status).toBe(200);
    }
    expect((await fromPeer(app, "2001:db8:ffff:1::5", "198.51.100.1")).status).toBe(429);
    expect((await fromPeer(app, "2001:db8:ffff:1::5", "198.51.100.2")).status).toBe(200);
    expect((await fromPeer(app, "fd00::1", "198.51.100.3")).status).toBe(200);
    expect((await fromPeer(app, "fd00::1", "198.51.100.4")).status).toBe(200);
    expect((await fromPeer(app, "fd00::1", "198.51.100.5")).status).toBe(429);
  });

  it("serves requests without a socket (the Hono test client) under one shared key", async () => {
    const app = buildApp();
    const plain = (forwardedFor: string) =>
      app.request("/api/v1/limited", { headers: { "x-forwarded-for": forwardedFor } });
    expect((await plain("198.51.100.1")).status).toBe(200);
    expect((await plain("198.51.100.2")).status).toBe(200);
    expect((await plain("198.51.100.3")).status).toBe(429);
  });

  it("prefers a Workers rate-limit binding when the environment provides one", async () => {
    const app = buildApp();
    const calls: string[] = [];
    const bindings = {
      TEST_LIMITER: {
        limit: async ({ key }: { key: string }) => {
          calls.push(key);
          return { success: calls.length < 2 };
        },
      },
    };
    expect((await fromPeer(app, "203.0.113.5", "198.51.100.1", bindings)).status).toBe(200);
    expect((await fromPeer(app, "203.0.113.5", "198.51.100.2", bindings)).status).toBe(429);
    expect(calls).toEqual(["203.0.113.5", "203.0.113.5"]);
  });
});

describe("sign-in rate limit", () => {
  it("limits a client that rotates addresses inside one IPv6 /64", async () => {
    const app = createTestApp();
    const statuses: number[] = [];
    for (let i = 1; i <= 25; i++) {
      const response = await app.request(
        "/api/v1/auth/login",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: "nobody@example.com", password: "wrong-password" }),
        },
        { incoming: { socket: { remoteAddress: `2001:db8:5:6::${i.toString(16)}` } } },
      );
      statuses.push(response.status);
    }
    expect(statuses).toEqual([...Array<number>(20).fill(401), ...Array<number>(5).fill(429)]);
  });
});
