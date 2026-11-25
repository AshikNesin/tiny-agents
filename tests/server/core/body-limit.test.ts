import { describe, expect, it } from "vite-plus/test";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { createApp } from "@groot/core/app";
import { routeBodyLimit } from "@groot/core/middlewares/body-limit.middleware";
import { Boom } from "@groot/core/errors";
import type { AppEnv } from "@groot/core/types";

function mediaRouter() {
  const router = new Hono<AppEnv>();
  const echo = async (c: { req: { text(): Promise<string> }; json(v: unknown): Response }) =>
    c.json({ size: (await c.req.text()).length });
  router.post("/upload", routeBodyLimit(64), echo as never);
  router.post("/notes", echo as never);
  router.post(
    "/worded",
    routeBodyLimit(64, {
      onError: () => {
        throw Boom.entityTooLarge("Files can be up to 64 bytes.");
      },
    }),
    echo as never,
  );
  return router;
}

function buildApp() {
  return createApp({
    bodyLimitBytes: 16,
    routes(app) {
      app.route("/api/v1/media", mediaRouter());
      const nested = new Hono<AppEnv>();
      nested.route("/files", mediaRouter());
      nested.onError((error, c) =>
        error instanceof HTTPException ? error.getResponse() : c.json({ error: "oops" }, 500),
      );
      app.route("/api/elsewhere", nested);
    },
  });
}

const post = (path: string, size: number) =>
  new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream", "Content-Length": String(size) },
    body: "x".repeat(size),
  });

const postStream = (path: string, size: number) =>
  new Request(`http://localhost${path}`, {
    method: "POST",
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (let sent = 0; sent < size; sent += 8) {
          controller.enqueue(new TextEncoder().encode("x".repeat(Math.min(8, size - sent))));
        }
        controller.close();
      },
    }),
    duplex: "half",
  } as RequestInit);

describe("routeBodyLimit", () => {
  it("a route's own limit applies wherever it is mounted", async () => {
    const app = buildApp();
    for (const path of ["/api/v1/media/upload", "/api/elsewhere/files/upload"]) {
      expect((await app.fetch(post(path, 48))).status, path).toBe(200);
      expect((await app.fetch(post(path, 65))).status, path).toBe(413);
    }
  });

  it("holds on streamed bodies with no Content-Length", async () => {
    const app = buildApp();
    for (const path of ["/api/v1/media/upload", "/api/elsewhere/files/upload"]) {
      const accepted = await app.fetch(postStream(path, 48));
      expect(accepted.status, path).toBe(200);
      expect(await accepted.json()).toEqual({ size: 48 });
      expect((await app.fetch(postStream(path, 65))).status, path).toBe(413);
    }
  });

  it("leaves the app's limit on the router's other routes", async () => {
    const app = buildApp();
    for (const path of ["/api/v1/media/notes", "/api/elsewhere/files/notes"]) {
      expect((await app.fetch(post(path, 8))).status, path).toBe(200);
      expect((await app.fetch(post(path, 48))).status, path).toBe(413);
      expect((await app.fetch(postStream(path, 48))).status, path).toBe(413);
    }
  });

  it("words the refusal with onError, through the app's error handler", async () => {
    const app = buildApp();
    const path = "/api/v1/media/worded";
    expect((await app.fetch(post(path, 48))).status).toBe(200);
    for (const request of [post(path, 65), postStream(path, 65)]) {
      const refused = await app.fetch(request);
      expect(refused.status).toBe(413);
      expect(await refused.json()).toMatchObject({
        success: false,
        error: { message: "Files can be up to 64 bytes." },
      });
    }
  });

  it("keeps a ceiling on a route without its own limit that overlaps a limited one", async () => {
    const router = new Hono<AppEnv>();
    const read = async (c: { req: { text(): Promise<string> }; json(v: unknown): Response }) =>
      c.json({ read: (await c.req.text()).length });
    router.post("/files/:name", read as never);
    router.post("/files/upload", routeBodyLimit(64), read as never);
    const app = createApp({
      bodyLimitBytes: 16,
      routes(app) {
        app.route("/api/v1", router);
      },
    });

    const allowed = await app.fetch(post("/api/v1/files/upload", 48));
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual({ read: 48 });

    expect((await app.fetch(post("/api/v1/files/upload", 65))).status).toBe(413);
    expect((await app.fetch(postStream("/api/v1/files/upload", 65))).status).toBe(413);
  });

  it("keeps each app's limit to itself when two apps share the process", async () => {
    const router = new Hono<AppEnv>();
    const read = async (c: { req: { text(): Promise<string> }; json(v: unknown): Response }) =>
      c.json({ read: (await c.req.text()).length });
    router.post("/notes", read as never);
    router.post("/upload", routeBodyLimit(256), read as never);
    const build = (bodyLimitBytes: number) =>
      createApp({
        bodyLimitBytes,
        routes(app) {
          app.route("/api/v1", router);
        },
      });
    const strict = build(16);
    const lenient = build(512);

    expect((await strict.fetch(post("/api/v1/notes", 48))).status).toBe(413);
    expect((await lenient.fetch(post("/api/v1/notes", 48))).status).toBe(200);

    for (const app of [strict, lenient]) {
      expect((await app.fetch(post("/api/v1/upload", 200))).status).toBe(200);
      expect((await app.fetch(post("/api/v1/upload", 257))).status).toBe(413);
    }
  });
});
