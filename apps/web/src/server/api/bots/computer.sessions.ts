/**
 * The server's computer session manager (issue #108): one per process, built
 * from the SANDBOX_* and COMPUTER_* env, shared by the computer toolkit (tool
 * calls), the routes and the VNC bridge (owner actions). The computer is a
 * desktop on the sandbox VM, so without a sandbox there is none: the toolkit
 * offers no tools and the routes report it as not configured. Tests
 * substitute their own through `setComputerSessionsForTests()`.
 */
import {
  createComputerSessions,
  createX11ComputerTransport,
  parseDesktopSize,
  parseExtraPackages,
  type ComputerSessions,
} from "@tiny-agents/agent/computer";
import { browserTargetForBot, browserTargetForConversation } from "./browser.targets";
import { sandboxConnection, sandboxEndpoint, unquoteEnv } from "./sandbox-host";
import { appEnv, type AppEnv } from "../../env";

/** Why the computer can't run, or undefined when it can. */
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

let instance: ComputerSessions | null | undefined;

/** The process's manager, created on first use; null when no sandbox VM is configured. */
export function getComputerSessions(env: AppEnv = appEnv()): ComputerSessions | null {
  if (instance !== undefined) return instance;
  const connection = sandboxConnection(env);
  if (!connection || computerSetupHint(env)) return (instance = null);
  const size = parseDesktopSize(unquoteEnv(env.COMPUTER_DESKTOP_SIZE));
  const idle = Number(unquoteEnv(env.COMPUTER_IDLE_MINUTES));
  instance = createComputerSessions({
    transport: createX11ComputerTransport({
      connection,
      extraPackages: parseExtraPackages(unquoteEnv(env.COMPUTER_EXTRA_PACKAGES)).packages,
    }),
    width: size.width,
    height: size.height,
    idleMinutes: Number.isFinite(idle) && idle > 0 ? idle : undefined,
  });
  return instance;
}

/** Route and toolkit tests inject their own; pass undefined to rebuild from the env. */
export function setComputerSessionsForTests(fake: ComputerSessions | null | undefined): void {
  instance = fake;
}

/** A bot's desktop: its browser profile's (`shared`, or `bot-<id>`). */
export function computerProfileForBot(bot: { id: string; browserProfile: string }): string {
  return browserTargetForBot(bot).profile;
}

/** The toolkit's resolver: tool calls know their conversation, not their bot. */
export async function computerProfileForConversation(conversationId: number): Promise<string> {
  return (await browserTargetForConversation(conversationId)).profile;
}
