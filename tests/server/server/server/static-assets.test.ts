import { describe, expect, it } from "vite-plus/test";
import { isAssetRequest } from "../../../../apps/web/src/server/static-assets";

describe("static assets", () => {
  it("tells build files apart from app routes", () => {
    expect(isAssetRequest("/assets/nope-123.js")).toBe(true);
    expect(isAssetRequest("/assets/files/inter-latin-wght-normal.woff2")).toBe(true);
    expect(isAssetRequest("/favicon.ico")).toBe(true);
    expect(isAssetRequest("/chats/cmvdqf4jv000077qlfba081d4")).toBe(false);
    expect(isAssetRequest("/vault/items/hi-nesin-io")).toBe(false);
    expect(isAssetRequest("/routines")).toBe(false);
  });

  it("treats anything under /assets/ and common static extensions as build output", () => {
    expect(isAssetRequest("/assets/")).toBe(true);
    expect(isAssetRequest("/assets/chunk")).toBe(true);
    expect(isAssetRequest("/manifest.webmanifest")).toBe(true);
    expect(isAssetRequest("/robots.txt")).toBe(true);
    expect(isAssetRequest("/LOGO.PNG")).toBe(true);
    expect(isAssetRequest("/index-abc123.js.map")).toBe(true);
    expect(isAssetRequest("/skills/my.js-helper")).toBe(false);
    expect(isAssetRequest("/")).toBe(false);
  });
});
