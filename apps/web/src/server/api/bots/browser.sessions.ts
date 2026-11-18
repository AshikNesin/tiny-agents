/**
 * The server's browser session manager (issue #24): one per process, built
 * from the BROWSER_* and SANDBOX_* env, shared by the browser toolkit (tool
 * calls) and the routes, the VNC bridge and the credential request submit
 * (owner actions), so every reader sees the same browsers. Tests substitute
 * their own through `setBrowserSessionsForTests()`.
 */
import {
  createBrowserSessions,
  createChromiumTransport,
  createRemoteCdpTransport,
  type BrowserSessions,
  type BrowserTransport,
} from "@tiny-agents/sandbox/browser";
import { sandboxConnection, sandboxEndpoint, unquoteEnv } from "./sandbox-host";
import { appEnv, type AppEnv } from "../../env";
import { app } from "../../app-root";

/**
 * Browser transport for the deploy model: chromium runs on the sandbox VM
 * (SANDBOX_HOST over Tailscale SSH), not in this container. With
 * BROWSER_EXECUTABLE_PATH set we drive that local binary instead (dev on
 * the exe.dev VM); with neither, Playwright's bundled Chromium.
 */
function browserTransport(env: AppEnv = appEnv()): BrowserTransport {
  const region = browserRegion(env);
  const executable = unquoteEnv(env.BROWSER_EXECUTABLE_PATH);
  if (executable) return createChromiumTransport({ executablePath: executable, ...region });
  const connection = sandboxConnection(env);
  if (connection) return createRemoteCdpTransport({ connection, ...region });
  return createChromiumTransport(region);
}

/** The owner's time zone (routines run in IST too) and language, as defaults. */
const DEFAULT_REGION = { locale: "en-IN", timezone: "Asia/Kolkata" };

/**
 * The language and time zone the browser tells sites. Bot checks such as
 * Amazon's compare them with where the IP is: a UTC clock and en-US from a
 * home IP in India reads as automation. A value Chrome would not take falls
 * back to the default.
 */
function browserRegion(env: AppEnv = appEnv()): { locale: string; timezone: string } {
  const locale = unquoteEnv(env.BROWSER_LOCALE)?.trim();
  const timezone = unquoteEnv(env.BROWSER_TIMEZONE)?.trim();
  return {
    locale: locale && isLocale(locale) ? locale : DEFAULT_REGION.locale,
    timezone: timezone && isTimeZone(timezone) ? timezone : DEFAULT_REGION.timezone,
  };
}

function isLocale(value: string): boolean {
  try {
    return Intl.getCanonicalLocales(value).length === 1;
  } catch {
    return false;
  }
}

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * Why this server's browsers have no live view, or undefined when they do:
 * only Chrome on the sandbox VM runs on a display that can be streamed; a
 * local binary or Playwright's Chromium runs headless.
 */
export function browserLiveViewHint(env: AppEnv = appEnv()): string | undefined {
  if (unquoteEnv(env.BROWSER_EXECUTABLE_PATH)) {
    return "BROWSER_EXECUTABLE_PATH runs a headless browser on this server, so there is nothing to show. Unset it and set SANDBOX_HOST for a live browser on the sandbox VM.";
  }
  if (!sandboxEndpoint(env)) {
    return "Bots browse headless on this server, so there is nothing to show. Set SANDBOX_HOST for a live browser on the sandbox VM.";
  }
  return undefined;
}

/** The process's manager (`app().browserSessions`), created on first use from the env. */
export function getBrowserSessions(env: AppEnv = appEnv()): BrowserSessions {
  return (app().browserSessions ??= createBrowserSessions({
    profilesDir: env.BROWSER_PROFILES_DIR ?? undefined,
    idleMinutes: env.BROWSER_IDLE_MINUTES ? Number(env.BROWSER_IDLE_MINUTES) : undefined,
    scale: Number(env.BROWSER_SCALE) === 1 ? 1 : 2,
    allowedPrivateHosts: unquoteEnv(env.BROWSER_ALLOWED_PRIVATE_HOSTS) ?? undefined,
    transport: browserTransport(env),
  }));
}

/** Route and toolkit tests inject their own; pass undefined to rebuild from the env. */
export function setBrowserSessionsForTests(fake: BrowserSessions | undefined): void {
  app().browserSessions = fake;
}
