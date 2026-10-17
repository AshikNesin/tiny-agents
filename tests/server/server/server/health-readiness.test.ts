import request from "supertest";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("@groot/core/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@groot/core/env")>();
  return { env: { ...actual.env, NODE_ENV: "production" } };
});

const { createServer } = await import("@groot/core/server");

const buildServer = (readiness?: () => string | undefined) =>
  createServer({
    distPath: process.cwd(),
    clientRoot: process.cwd(),
    readiness,
  });

describe("server health and readiness", () => {
  it("returns healthy when readiness is omitted", async () => {
    const { app } = await buildServer();

    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("ok");
  });

  it("returns not ready with the probe reason", async () => {
    const { app } = await buildServer(() => "agent store is resuming");

    const [health, ready] = await Promise.all([
      request(app).get("/health"),
      request(app).get("/ready"),
    ]);

    expect(health.status).toBe(503);
    expect(health.body).toMatchObject({ status: "not_ready", reason: "agent store is resuming" });
    expect(ready.status).toBe(503);
    expect(ready.body).toEqual({ ready: false, reason: "agent store is resuming" });
  });

  it("returns healthy after readiness flips to undefined", async () => {
    let ready = false;
    const { app } = await buildServer(() => (ready ? undefined : "agent store is resuming"));

    expect((await request(app).get("/ready")).status).toBe(503);

    ready = true;
    const [health, readiness] = await Promise.all([
      request(app).get("/health"),
      request(app).get("/ready"),
    ]);

    expect(health.status).toBe(200);
    expect(health.body.status).toBe("ok");
    expect(readiness.status).toBe(200);
    expect(readiness.body).toEqual({ ready: true });
  });
});
