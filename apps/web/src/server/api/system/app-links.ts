import { routes } from "../routes";
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

const appLinksRouter = routes();

appLinksRouter.get("/.well-known/assetlinks.json", (c) => {
  const statements = assetLinks();
  if (!statements) return c.json({ error: "Android app links are not set up" }, 404);
  return c.json(statements, 200, { "Cache-Control": "public, max-age=3600" });
});

export default appLinksRouter.hono;
