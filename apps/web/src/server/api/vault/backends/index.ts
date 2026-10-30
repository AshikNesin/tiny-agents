/**
 * The vault's read-path backends: what the agent's broker resolves through.
 * Connect gets the READ-only token here; the read+write token is loaded only
 * by `vault.admin.service.ts`.
 */
import { appEnv } from "../../../env";
import { createConnectBackend } from "./onepassword-connect";
import { createLocalBackend } from "./local";
import type { BackendName, VaultBackend } from "./types";

export interface ConnectConfig {
  host: string;
  vaultId: string;
}

const unquote = (value: string | undefined) =>
  value
    ?.trim()
    .replace(/^(['"])([\s\S]*)\1$/, "$2")
    .trim() || undefined;

/** Connect's host and pinned vault from env, or `undefined` when not configured. */
export function connectConfig(): ConnectConfig | undefined {
  const env = appEnv();
  const host = unquote(env.OP_CONNECT_HOST);
  const vaultId = unquote(env.OP_CONNECT_VAULT_ID);
  return host && vaultId ? { host, vaultId } : undefined;
}

let backends: Map<BackendName, VaultBackend> | undefined;

/** Read-path backends by name, built once per process. */
export function readBackends(): Map<BackendName, VaultBackend> {
  if (backends) return backends;
  const map = new Map<BackendName, VaultBackend>([["local", createLocalBackend()]]);
  const connect = connectConfig();
  if (connect) {
    map.set(
      "onepassword-connect",
      createConnectBackend({
        ...connect,
        token: unquote(appEnv().OP_CONNECT_TOKEN) ?? "",
        writable: false,
      }),
    );
  }
  backends = map;
  return map;
}

/** Where new items go: 1Password when configured, else the local backend. */
export function primaryBackend(): BackendName {
  return connectConfig() ? "onepassword-connect" : "local";
}

/** Test seam: substitute backends (fakes, or Connect against a fake server). */
export function setReadBackendsForTests(map: Map<BackendName, VaultBackend> | undefined): void {
  backends = map;
}
