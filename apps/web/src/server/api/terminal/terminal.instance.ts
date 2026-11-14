/**
 * The server's TerminalService singleton (issue #28): built once on the
 * process's sandbox connection (`sandbox-host.ts`), shared with every other
 * SSH user, whose host-key pins persist through the app's KV.
 * Tests substitute a fake via `setTerminalServiceForTests()`.
 */
import { createTerminalService, type TerminalService } from "@tiny-agents/agent/terminal";
import { sandboxConnection } from "../bots/sandbox-host";
import { app } from "../../app-root";

export function getTerminalService(): TerminalService {
  const existing = app().terminalService;
  if (existing) return existing;
  // The process's one sandbox connection: execs and attaches share the
  // pooled SSH connection with the toolkits, the browser and the computer.
  const service = createTerminalService({ connection: sandboxConnection() });
  // An unconfigured sandbox yields a service that reports `unconfigured`;
  // nothing below throws on it, so no test reset needs to distinguish.
  return (app().terminalService = service);
}

/** Route/WS tests inject a fake; pass undefined to restore production. */
export function setTerminalServiceForTests(fake: TerminalService | undefined): void {
  app().terminalService = fake;
}
