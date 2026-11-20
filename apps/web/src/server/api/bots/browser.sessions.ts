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

function browserTransport(env: AppEnv = appEnv()): BrowserTransport {
  const region = browserRegion(env);
  const executable = unquoteEnv(env.BROWSER_EXECUTABLE_PATH);
  if (executable) return createChromiumTransport({ executablePath: executable, ...region });
  const connection = sandboxConnection(env);
  if (connection) return createRemoteCdpTransport({ connection, ...region });
  return createChromiumTransport(region);
}

const DEFAULT_REGION = { locale: "en-IN", timezone: "Asia/Kolkata" };

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

export function browserLiveViewHint(env: AppEnv = appEnv()): string | undefined {
  if (unquoteEnv(env.BROWSER_EXECUTABLE_PATH)) {
    return "BROWSER_EXECUTABLE_PATH runs a headless browser on this server, so there is nothing to show. Unset it and set SANDBOX_HOST for a live browser on the sandbox VM.";
  }
  if (!sandboxEndpoint(env)) {
    return "Bots browse headless on this server, so there is nothing to show. Set SANDBOX_HOST for a live browser on the sandbox VM.";
  }
  return undefined;
}

export function getBrowserSessions(env: AppEnv = appEnv()): BrowserSessions {
  return (app().browserSessions ??= createBrowserSessions({
    profilesDir: env.BROWSER_PROFILES_DIR ?? undefined,
    idleMinutes: env.BROWSER_IDLE_MINUTES ? Number(env.BROWSER_IDLE_MINUTES) : undefined,
    scale: Number(env.BROWSER_SCALE) === 1 ? 1 : 2,
    allowedPrivateHosts: unquoteEnv(env.BROWSER_ALLOWED_PRIVATE_HOSTS) ?? undefined,
    transport: browserTransport(env),
  }));
}

export function setBrowserSessionsForTests(fake: BrowserSessions | undefined): void {
  app().browserSessions = fake;
}
