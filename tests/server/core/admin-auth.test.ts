import { describe, expect, it } from "vite-plus/test";
import { peerClientAddress } from "@groot/core/utils/client-ip";
import { createTestApp, setAppConfig } from "../helpers";

const fromTestPeer = peerClientAddress((c) => c.req.header("x-test-peer"));

function request(app: ReturnType<typeof createTestApp>, peer: string, key?: string) {
  const headers: Record<string, string> = { "x-test-peer": peer };
  if (key !== undefined) headers["x-admin-auth-key"] = key;
  return app.request("/api/v1/auth/users", { headers });
}

describe("admin auth key rate limit", () => {
  it("blocks repeated wrong keys from one client after the window's failures, per client", async () => {
    setAppConfig({ rateLimits: { adminKey: { windowMs: 60_000, max: 3 } } });
    const app = createTestApp({ clientAddress: fromTestPeer });
    const wrong = (peer: string) => request(app, peer, "not-the-key");

    for (let i = 0; i < 3; i++) expect((await wrong("198.51.100.1")).status).toBe(403);
    expect((await wrong("198.51.100.1")).status).toBe(429);
    expect((await wrong("198.51.100.1")).status).toBe(429);

    expect((await wrong("198.51.100.2")).status).toBe(403);
    expect((await wrong("2001:db8:1:2::1")).status).toBe(403);
  });

  it("never counts a correct key or a missing one", async () => {
    setAppConfig({ rateLimits: { adminKey: { windowMs: 60_000, max: 2 } } });
    const app = createTestApp({ clientAddress: fromTestPeer });

    expect((await request(app, "198.51.100.7")).status).toBe(401);
    expect((await request(app, "198.51.100.7")).status).toBe(401);
    expect((await request(app, "198.51.100.7", "wrong")).status).toBe(403);
    expect((await request(app, "198.51.100.7", "wrong")).status).toBe(403);
    expect((await request(app, "198.51.100.7", "wrong")).status).toBe(429);

    const { env } = await import("@groot/core/env");
    expect((await request(app, "198.51.100.7", env.ADMIN_AUTH_KEY)).status).toBe(200);
    expect((await request(app, "198.51.100.7")).status).toBe(401);
  });
});
