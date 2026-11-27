import { Hono } from "hono";
import type { AppEnv } from "@groot/core/types";
import { appEnv, type AppEnv as AppVars } from "../../env";

const DEFAULT_ANDROID_PACKAGE = "io.nesin.tinyagents";

function fingerprint(raw: string): string | null {
  const hex = raw.replace(/[:\s]/g, "").toUpperCase();
  if (!/^[0-9A-F]{64}$/.test(hex)) return null;
  return hex.match(/../g)!.join(":");
}

interface AssetLinkStatement {
  relation: string[];
  target: { namespace: "android_app"; package_name: string; sha256_cert_fingerprints: string[] };
}

function fingerprints(env: Pick<AppVars, "ANDROID_APP_CERT_SHA256">): string[] {
  return (env.ANDROID_APP_CERT_SHA256 ?? "")
    .split(",")
    .map((value) => fingerprint(value))
    .filter((value): value is string => value !== null);
}

export function androidPasskeyOrigins(
  env: Pick<AppVars, "ANDROID_APP_CERT_SHA256"> = appEnv(),
): string[] {
  return fingerprints(env).map((print) => {
    const bytes = Uint8Array.from(print.split(":"), (pair) => Number.parseInt(pair, 16));
    return `android:apk-key-hash:${Buffer.from(bytes).toString("base64url")}`;
  });
}

export function assetLinks(
  env: Pick<AppVars, "ANDROID_APP_CERT_SHA256" | "ANDROID_APP_PACKAGE"> = appEnv(),
): AssetLinkStatement[] | null {
  const prints = fingerprints(env);
  if (prints.length === 0) return null;
  return [
    {
      relation: [
        "delegate_permission/common.handle_all_urls",
        "delegate_permission/common.get_login_creds",
      ],
      target: {
        namespace: "android_app",
        package_name: env.ANDROID_APP_PACKAGE ?? DEFAULT_ANDROID_PACKAGE,
        sha256_cert_fingerprints: prints,
      },
    },
  ];
}

const appLinksRouter = new Hono<AppEnv>();

appLinksRouter.get("/.well-known/assetlinks.json", (c) => {
  const statements = assetLinks();
  if (!statements) return c.json({ error: "Android app links are not set up" }, 404);
  return c.json(statements, 200, { "Cache-Control": "public, max-age=3600" });
});

export default appLinksRouter;
