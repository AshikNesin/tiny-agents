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
} from "@tiny-agents/agent";
import { sandboxEndpoint, unquoteEnv } from "./sandbox-host";

type Env = Readonly<Record<string, string | undefined>>;

/**
 * Browser transport for the deploy model: chromium runs on the sandbox VM
 * (SANDBOX_HOST over Tailscale SSH), not in this container. With
 * BROWSER_EXECUTABLE_PATH set we drive that local binary instead (dev on
 * the exe.dev VM); with neither, Playwright's bundled Chromium.
 */
export function browserTransport(env: Env = process.env): BrowserTransport {
  const executable = unquoteEnv(env.BROWSER_EXECUTABLE_PATH);
  if (executable) return createChromiumTransport({ executablePath: executable });
  const endpoint = sandboxEndpoint(env);
  if (endpoint) return createRemoteCdpTransport(endpoint);
  return createChromiumTransport();
}

let instance: BrowserSessions | undefined;

/** The process's manager, created on first use from the env. */
export function getBrowserSessions(env: Env = process.env): BrowserSessions {
  return (instance ??= createBrowserSessions({
    profilesDir: env.BROWSER_PROFILES_DIR ?? undefined,
    idleMinutes: env.BROWSER_IDLE_MINUTES ? Number(env.BROWSER_IDLE_MINUTES) : undefined,
    scale: Number(env.BROWSER_SCALE) === 1 ? 1 : 2,
    allowedPrivateHosts: unquoteEnv(env.BROWSER_ALLOWED_PRIVATE_HOSTS) ?? undefined,
    transport: browserTransport(env),
  }));
}

/** Route and toolkit tests inject their own; pass undefined to rebuild from the env. */
export function setBrowserSessionsForTests(fake: BrowserSessions | undefined): void {
  instance = fake;
}
