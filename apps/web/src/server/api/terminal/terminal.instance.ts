/**
 * The server's TerminalService singleton (issue #28): built once from the
 * SANDBOX_* env, host-key pins persisted through the app's KV so a restart
 * remembers what it trusted on first connect. Tests substitute a fake via
 * `setTerminalServiceForTests()` (the bots.runtime pattern).
 */
import { createNamespaceKv } from "@groot/core/kv";
import {
  createMemoryHostKeyStore,
  createTerminalService,
  type HostKeyStore,
  type TerminalService,
} from "@tiny-agents/agent";

const unquote = (value: string | undefined) =>
  value
    ?.trim()
    .replace(/^(['"])([\s\S]*)\1$/, "$2")
    .trim() || undefined;

/** KV-backed TOFU store; memory fallback keeps tests key-free. */
function kvHostKeyStore(): HostKeyStore {
  try {
    const kv = createNamespaceKv("TERMINAL");
    return {
      async get(host) {
        return (await kv.get<string>(host)) ?? undefined;
      },
      async set(host, hash) {
        await kv.set(host, hash);
      },
    };
  } catch {
    return createMemoryHostKeyStore();
  }
}

let instance: TerminalService | undefined;
let overridden = false;

export function getTerminalService(): TerminalService {
  if (instance) return instance;
  const service = createTerminalService({
    host: unquote(process.env.SANDBOX_HOST),
    port: process.env.SANDBOX_PORT ? Number(process.env.SANDBOX_PORT) : undefined,
    user: unquote(process.env.SANDBOX_USER),
    hostKeys: kvHostKeyStore(),
  });
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
