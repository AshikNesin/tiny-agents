import { Hono } from "hono";
import type { AppEnv } from "@groot/core/types";
import { appEnv, type AppEnv as AppVars } from "../../env";

/** The Android app's id (`applicationId` in mobile/android/app/build.gradle.kts). */
const DEFAULT_ANDROID_PACKAGE = "io.nesin.tinyagents";

/** A SHA-256 certificate fingerprint as Android lists it: 32 upper-case hex bytes joined by colons. */
function fingerprint(raw: string): string | null {
  const hex = raw.replace(/[:\s]/g, "").toUpperCase();
  if (!/^[0-9A-F]{64}$/.test(hex)) return null;
  return hex.match(/../g)!.join(":");
}

interface AssetLinkStatement {
  relation: string[];
  target: { namespace: "android_app"; package_name: string; sha256_cert_fingerprints: string[] };
}

/**
 * Digital Asset Links for the Android app (docs/features/mobile-app.md): Android fetches this
 * to verify that the app may open this server's links, such as a push notification's
 * `/chats/<bot>?focus=approval:<task>`. Null (a 404) until `ANDROID_APP_CERT_SHA256` is set.
 */
export function assetLinks(
  env: Pick<AppVars, "ANDROID_APP_CERT_SHA256" | "ANDROID_APP_PACKAGE"> = appEnv(),
): AssetLinkStatement[] | null {
  const prints = (env.ANDROID_APP_CERT_SHA256 ?? "")
    .split(",")
    .map((value) => fingerprint(value))
    .filter((value): value is string => value !== null);
  if (prints.length === 0) return null;
  return [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: env.ANDROID_APP_PACKAGE ?? DEFAULT_ANDROID_PACKAGE,
        sha256_cert_fingerprints: prints,
      },
    },
  ];
}

/** Public: Android's verifier fetches it without a session. */
const appLinksRouter = new Hono<AppEnv>();

appLinksRouter.get("/.well-known/assetlinks.json", (c) => {
  const statements = assetLinks();
  if (!statements) return c.json({ error: "Android app links are not set up" }, 404);
  return c.json(statements, 200, { "Cache-Control": "public, max-age=3600" });
});

export default appLinksRouter;
