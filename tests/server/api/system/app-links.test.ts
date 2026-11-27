import { afterEach, describe, expect, it } from "vite-plus/test";
import { assetLinks } from "../../../../apps/web/src/server/api/system/app-links";
import { createTestApp } from "../../helpers";

const app = createTestApp();
const PRINT = "ab".repeat(32);
const COLONS = Array.from({ length: 32 }, () => "AB").join(":");

describe("Android app links", () => {
  afterEach(() => {
    delete process.env.ANDROID_APP_CERT_SHA256;
    delete process.env.ANDROID_APP_PACKAGE;
  });

  it("is a 404 until a certificate is set", async () => {
    expect(assetLinks({})).toBeNull();
    const res = await app.request("/.well-known/assetlinks.json");
    expect(res.status).toBe(404);
  });

  it("publishes the statement without a session, fingerprints in Android's form", async () => {
    process.env.ANDROID_APP_CERT_SHA256 = `${PRINT}, ${COLONS.toLowerCase()}, not-a-print`;
    const res = await app.request("/.well-known/assetlinks.json");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual([
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: "io.nesin.tinyagents",
          sha256_cert_fingerprints: [COLONS, COLONS],
        },
      },
    ]);
  });

  it("takes another package name", () => {
    const links = assetLinks({
      ANDROID_APP_CERT_SHA256: PRINT,
      ANDROID_APP_PACKAGE: "com.example.agents",
    });
    expect(links?.[0]?.target.package_name).toBe("com.example.agents");
  });
});
