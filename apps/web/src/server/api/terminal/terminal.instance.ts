/**
 * The server's TerminalService singleton (issue #28): built once from the
 * sandbox endpoint (`sandbox-host.ts`), whose host-key pins persist through
 * the app's KV so a restart remembers what it trusted on first connect.
 * Tests substitute a fake via `setTerminalServiceForTests()`.
 */
import { createTerminalService, type TerminalService } from "@tiny-agents/agent";
import { sandboxEndpoint } from "../bots/sandbox-host";

let instance: TerminalService | undefined;
let overridden = false;

export function getTerminalService(): TerminalService {
  if (instance) return instance;
  // The sandbox endpoint, pins included: the same key store the sandbox
  // toolkit and the browser tunnel pin by, so the VM's key is trusted once.
  const service = createTerminalService(sandboxEndpoint() ?? {});
  // An unconfigured sandbox yields a service that reports `unconfigured`;
  // nothing below throws on it, so no test reset needs to distinguish.
  return (instance = service);
}

/** Route/WS tests inject a fake; pass undefined to restore production. */
export function setTerminalServiceForTests(fake: TerminalService | undefined): void {
  instance = fake;
  overridden = Boolean(fake);
}

export function terminalServiceOverriddenForTests(): boolean {
  return overridden;
}
