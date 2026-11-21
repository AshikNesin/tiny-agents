import {
  createComputerSessions,
  createX11ComputerTransport,
  parseDesktopSize,
  parseExtraPackages,
  type ComputerSessions,
} from "@tiny-agents/sandbox/computer";
import { DEFAULT_BROWSER_PROFILES_DIR } from "@tiny-agents/sandbox/browser";
import { browserTargetForBot, browserTargetForConversation } from "./browser.targets";
import { sandboxConnection, sandboxEndpoint, unquoteEnv } from "./sandbox-host";
import { appEnv, type AppEnv } from "../../env";
import { app } from "../../app-root";

export function computerSetupHint(env: AppEnv = appEnv()): string | undefined {
  if (!sandboxEndpoint(env)) return "Set SANDBOX_HOST to give bots a computer on the sandbox VM.";
  const size = parseDesktopSize(unquoteEnv(env.COMPUTER_DESKTOP_SIZE));
  if (size.invalid) {
    return `COMPUTER_DESKTOP_SIZE "${size.invalid}" is not WIDTHxHEIGHT between 640x480 and 1920x1200.`;
  }
  const extra = parseExtraPackages(unquoteEnv(env.COMPUTER_EXTRA_PACKAGES));
  if (extra.invalid.length > 0) {
    return `COMPUTER_EXTRA_PACKAGES has entries that aren't package names: ${extra.invalid.join(", ")}`;
  }
  return undefined;
}

export function getComputerSessions(env: AppEnv = appEnv()): ComputerSessions | null {
  const root = app();
  if (root.computerSessions !== undefined) return root.computerSessions;
  const connection = sandboxConnection(env);
  if (!connection || computerSetupHint(env)) return (root.computerSessions = null);
  const size = parseDesktopSize(unquoteEnv(env.COMPUTER_DESKTOP_SIZE));
  const idle = Number(unquoteEnv(env.COMPUTER_IDLE_MINUTES));
  const instance = createComputerSessions({
    transport: createX11ComputerTransport({
      connection,
      extraPackages: parseExtraPackages(unquoteEnv(env.COMPUTER_EXTRA_PACKAGES)).packages,
      browserProfilesDir: unquoteEnv(env.BROWSER_EXECUTABLE_PATH)
        ? undefined
        : (env.BROWSER_PROFILES_DIR ?? DEFAULT_BROWSER_PROFILES_DIR),
    }),
    width: size.width,
    height: size.height,
    idleMinutes: Number.isFinite(idle) && idle > 0 ? idle : undefined,
  });
  root.computerSessions = instance;
  return instance;
}

export function setComputerSessionsForTests(fake: ComputerSessions | null | undefined): void {
  app().computerSessions = fake;
}

export function computerProfileForBot(bot: { id: string; browserProfile: string }): string {
  return browserTargetForBot(bot).profile;
}

export async function computerProfileForConversation(conversationId: number): Promise<string> {
  return (await browserTargetForConversation(conversationId)).profile;
}
