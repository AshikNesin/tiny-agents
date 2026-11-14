/**
 * The sandbox VM as the server reaches it: host, port, user, the optional
 * SSH key and the one host-key store, read from the SANDBOX_* env, and the
 * one `SandboxConnection` built from them. The sandbox toolkit, attachments,
 * the terminal, the browser, the computer and the Claude worker all take
 * that connection, so the VM's key is pinned once, under one name, and they
 * share one pooled SSH connection.
 */
import { readFileSync } from "node:fs";
import { createNamespaceKv } from "@groot/core/kv";
import {
  createMemoryHostKeyStore,
  createSandboxConnection,
  type HostKeyStore,
  type SandboxConnection,
  type SshEndpoint,
} from "@tiny-agents/sandbox";
import { appEnv, type AppEnv } from "../../env";
import { app } from "../../app-root";

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
export function sandboxHost(env: AppEnv = appEnv()): string | undefined {
  return (
    unquoteEnv(env.SANDBOX_HOST) ?? (env.NODE_ENV === "production" ? "tiny-agents-vm" : undefined)
  );
}

/**
 * The TOFU host-key pins, one per host, persisted through the app's KV (the
 * `kv` table) so a restart remembers what it trusted on first connect. One
 * store for every SSH user of the VM; the memory fallback keeps tests
 * key-free.
 */
function sandboxHostKeys(): HostKeyStore {
  const root = app();
  if (root.sandboxHostKeys) return root.sandboxHostKeys;
  try {
    const kv = createNamespaceKv("SANDBOX");
    root.sandboxHostKeys = {
      async get(host) {
        return (await kv.get<string>(host)) ?? undefined;
      },
      async set(host, hash) {
        await kv.set(host, hash);
      },
    };
  } catch {
    root.sandboxHostKeys = createMemoryHostKeyStore();
  }
  return root.sandboxHostKeys;
}

const keyFiles = new Map<string, string>();

/**
 * The private key for public-key auth, or undefined for keyless Tailscale
 * SSH (the default). `SANDBOX_SSH_KEY` holds the key itself (`\n` escapes
 * allowed, for one-line env files); `SANDBOX_SSH_KEY_FILE` names a file, read
 * once per path (a fix needs a restart). A local sandbox container (`docker/sandbox/`) needs one,
 * because it is reached without a tailnet to authenticate the app.
 */
export function sandboxPrivateKey(env: AppEnv = appEnv()): string | undefined {
  const inline = unquoteEnv(env.SANDBOX_SSH_KEY);
  if (inline) return `${inline.replaceAll("\\n", "\n").trim()}\n`;
  const path = unquoteEnv(env.SANDBOX_SSH_KEY_FILE);
  if (!path) return undefined;
  if (keyFiles.has(path)) return keyFiles.get(path) || undefined;
  let key = "";
  try {
    key = readFileSync(path, "utf8");
  } catch (error) {
    // Logged once, not thrown: a bad path must not take the whole runtime
    // down. The sandbox tools then fail their SSH auth until it is fixed.
    console.error(
      `SANDBOX_SSH_KEY_FILE ${path} can't be read (${(error as Error).message}). ` +
        "Run `pnpm sandbox:up` to create the local sandbox's key, or unset it for Tailscale SSH.",
    );
  }
  keyFiles.set(path, key);
  return key || undefined;
}

/** The endpoint every SSH user dials, or undefined when no sandbox is configured. */
export function sandboxEndpoint(env: AppEnv = appEnv()): SshEndpoint | undefined {
  const host = sandboxHost(env);
  if (!host) return undefined;
  return {
    host,
    port: env.SANDBOX_PORT ? Number(env.SANDBOX_PORT) : undefined,
    user: unquoteEnv(env.SANDBOX_USER),
    hostKeys: sandboxHostKeys(),
    privateKey: sandboxPrivateKey(env),
  };
}

/**
 * The process's connection to the sandbox, or undefined when none is
 * configured: built once per endpoint and shared by every SSH user.
 */
export function sandboxConnection(env: AppEnv = appEnv()): SandboxConnection | undefined {
  const endpoint = sandboxEndpoint(env);
  if (!endpoint) return undefined;
  const { host, port, user, privateKey } = endpoint;
  const key = JSON.stringify([host, port, user, privateKey]);
  const connections = app().sandboxConnections;
  let connection = connections.get(key);
  if (!connection) {
    connection = createSandboxConnection(endpoint);
    connections.set(key, connection);
  }
  return connection;
}

/** Shutdown: end the sandbox connections, after everything that uses them stopped. */
export function closeSandboxConnections(): void {
  const connections = app().sandboxConnections;
  for (const connection of connections.values()) connection.close();
  connections.clear();
}

/** Tests: forget the pinned-key store so the next call rebuilds it. */
export function resetSandboxHostKeysForTests(): void {
  app().sandboxHostKeys = undefined;
  keyFiles.clear();
  closeSandboxConnections();
}
