import { createTerminalService, type TerminalService } from "@tiny-agents/sandbox/terminal";
import { sandboxConnection } from "../bots/sandbox-host";
import { app } from "../../app-root";

export function getTerminalService(): TerminalService {
  const existing = app().terminalService;
  if (existing) return existing;
  const service = createTerminalService({ connection: sandboxConnection() });
  return (app().terminalService = service);
}

export function setTerminalServiceForTests(fake: TerminalService | undefined): void {
  app().terminalService = fake;
}
