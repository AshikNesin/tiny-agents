import path from "node:path";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { isAssetRequest, setupSpaFallback, staticCacheControl } from "@groot/core/server";

/**
 * Static file caching and the SPA fallback (issue #83): fingerprinted build
 * output is immutable, everything else revalidates, and a missing asset is a
 * 404 rather than index.html with a 200. The fallback runs in production mode
 * here only through its asset short-circuit, which does not depend on it.
 */
describe("static assets", () => {
  let dist: string;

  beforeAll(async () => {
    dist = await mkdtemp(path.join(tmpdir(), "dist-"));
    await mkdir(path.join(dist, "assets"));
    await writeFile(path.join(dist, "index.html"), "<!doctype html><title>app</title>");
    await writeFile(path.join(dist, "assets", "index-abc123.js"), "console.log(1)");
  });

  afterAll(async () => {
    await rm(dist, { recursive: true, force: true });
  });

  it("caches fingerprinted files for a year and revalidates the rest", () => {
    expect(staticCacheControl(path.join("assets", "index-abc123.js"))).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(staticCacheControl("favicon.svg")).toBe("no-cache, no-store, must-revalidate");
    expect(staticCacheControl("index.html")).toBe("no-cache, no-store, must-revalidate");
  });

  it("tells build files apart from app routes", () => {
    expect(isAssetRequest("/assets/nope-123.js")).toBe(true);
    expect(isAssetRequest("/assets/files/inter-latin-wght-normal.woff2")).toBe(true);
    expect(isAssetRequest("/favicon.ico")).toBe(true);
    expect(isAssetRequest("/chats/cmvdqf4jv000077qlfba081d4")).toBe(false);
    expect(isAssetRequest("/vault/items/hi-nesin-io")).toBe(false);
    expect(isAssetRequest("/routines")).toBe(false);
  });

  it("404s a missing asset with no-store instead of serving index.html", async () => {
    const app = express();
    app.use(
      express.static(dist, {
        index: false,
        setHeaders: (res, filePath) =>
          res.setHeader("Cache-Control", staticCacheControl(path.relative(dist, filePath))),
      }),
    );
    setupSpaFallback(app, null, dist, dist);

    const hit = await request(app).get("/assets/index-abc123.js").expect(200);
    expect(hit.headers["cache-control"]).toBe("public, max-age=31536000, immutable");

    const miss = await request(app).get("/assets/nope-123.js").expect(404);
    expect(miss.headers["content-type"]).toMatch(/text\/plain/);
    expect(miss.headers["cache-control"]).toBe("no-store");
  });
});
