/**
 * The sandbox VM as the server reaches it: host, port, user and the one
 * host-key store, read from the SANDBOX_* env. One answer for the sandbox
 * toolkit, attachments, the browser's SSH tunnel and the terminal, so the
 * VM's key is pinned once, under one name, for every SSH user.
 */
import { createNamespaceKv } from "@groot/core/kv";
import { createMemoryHostKeyStore, type HostKeyStore, type SshEndpoint } from "@tiny-agents/agent";

type Env = Readonly<Record<string, string | undefined>>;

/** An env value without the quotes a .env file may carry; empty means unset. */
export const unquoteEnv = (value: string | undefined) =>
  value
    ?.trim()
    .replace(/^(['"])([\s\S]*)\1$/, "$2")
    .trim() || undefined;

/**
 * The sandbox VM host, or undefined when none is configured. Production
 * keeps the verified MagicDNS name (issue #19 runbook) as its default, so an
 * empty value there still reaches the VM; elsewhere empty means "no sandbox"
 * and the browser falls back to local Chromium (issue #79).
 */
export function sandboxHost(env: Env = process.env): string | undefined {
  return (
    unquoteEnv(env.SANDBOX_HOST) ?? (env.NODE_ENV === "production" ? "tiny-agents-vm" : undefined)
  );
}

let hostKeys: HostKeyStore | undefined;

/**
 * The TOFU host-key pins, one per host, persisted through the app's KV (the
 * `kv` table) so a restart remembers what it trusted on first connect. One
 * store for every SSH user of the VM; the memory fallback keeps tests
 * key-free.
 */
export function sandboxHostKeys(): HostKeyStore {
  if (hostKeys) return hostKeys;
  try {
    const kv = createNamespaceKv("SANDBOX");
    hostKeys = {
      async get(host) {
        return (await kv.get<string>(host)) ?? undefined;
      },
      async set(host, hash) {
        await kv.set(host, hash);
      },
    };
  } catch {
    hostKeys = createMemoryHostKeyStore();
  }
  return hostKeys;
}

/** The endpoint every SSH user dials, or undefined when no sandbox is configured. */
export function sandboxEndpoint(env: Env = process.env): SshEndpoint | undefined {
  const host = sandboxHost(env);
  if (!host) return undefined;
  return {
    host,
    port: env.SANDBOX_PORT ? Number(env.SANDBOX_PORT) : undefined,
    user: unquoteEnv(env.SANDBOX_USER),
    hostKeys: sandboxHostKeys(),
  };
}

/** Tests: forget the pinned-key store so the next call rebuilds it. */
export function resetSandboxHostKeysForTests(): void {
  hostKeys = undefined;
}
