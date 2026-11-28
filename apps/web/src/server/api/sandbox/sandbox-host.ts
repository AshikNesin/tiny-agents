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

export const unquoteEnv = (value: string | undefined) =>
  value
    ?.trim()
    .replace(/^(['"])([\s\S]*)\1$/, "$2")
    .trim() || undefined;

export function sandboxHost(env: AppEnv = appEnv()): string | undefined {
  return (
    unquoteEnv(env.SANDBOX_HOST) ?? (env.NODE_ENV === "production" ? "tiny-agents-vm" : undefined)
  );
}

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

export function sandboxPrivateKey(env: AppEnv = appEnv()): string | undefined {
  const inline = unquoteEnv(env.SANDBOX_SSH_KEY);
  if (inline) return `${inline.replaceAll("\\n", "\n").trim()}\n`;
  const path = unquoteEnv(env.SANDBOX_SSH_KEY_FILE);
  if (!path) return undefined;
  const keyFiles = app().sandboxKeyFiles;
  if (keyFiles.has(path)) return keyFiles.get(path) || undefined;
  let key = "";
  try {
    key = readFileSync(path, "utf8");
  } catch (error) {
    console.error(
      `SANDBOX_SSH_KEY_FILE ${path} can't be read (${(error as Error).message}). ` +
        "Run `pnpm sandbox:up` to create the local sandbox's key, or unset it for Tailscale SSH.",
    );
  }
  keyFiles.set(path, key);
  return key || undefined;
}

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

export function closeSandboxConnections(): void {
  const connections = app().sandboxConnections;
  for (const connection of connections.values()) connection.close();
  connections.clear();
}

export function resetSandboxHostKeysForTests(): void {
  app().sandboxHostKeys = undefined;
  app().sandboxKeyFiles.clear();
  closeSandboxConnections();
}
