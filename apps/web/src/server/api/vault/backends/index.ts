/**
 * The vault's read-path backends: what the agent's broker resolves through.
 * 1Password Connect gets the READ-only token here; the read+write token is
 * loaded only by `vault.admin.service.ts`.
 */
import { appEnv } from "../../../env";
import { BUNDLED_CONNECT_HOST, bundledConnectWanted } from "../connect/bundled-connect";
import { createConnectBackend } from "./onepassword-connect";
import { createLocalBackend } from "./local";
import type { BackendName, VaultBackend } from "./types";

export interface ConnectConfig {
  host: string;
  /** Unset: the tokens' one visible vault. */
  vaultId?: string;
  /** The app runs this Connect server itself (`connect/bundled-connect.ts`). */
  bundled: boolean;
  readToken?: string;
  adminToken?: string;
}

const unquote = (value: string | undefined) =>
  value
    ?.trim()
    .replace(/^(['"])([\s\S]*)\1$/, "$2")
    .trim() || undefined;

/** Connect's host, pinned vault and tokens from env, or `undefined` without a server or token. */
export function connectConfig(): ConnectConfig | undefined {
  const env = appEnv();
  const bundled = bundledConnectWanted();
  const host = bundled ? BUNDLED_CONNECT_HOST : unquote(env.OP_CONNECT_HOST);
  const readToken = unquote(env.OP_CONNECT_TOKEN);
  const adminToken = unquote(env.OP_CONNECT_ADMIN_TOKEN);
  if (!host || (!readToken && !adminToken)) return undefined;
  const vaultId = unquote(env.OP_CONNECT_VAULT_ID);
  return {
    host,
    bundled,
    ...(vaultId ? { vaultId } : {}),
    ...(readToken ? { readToken } : {}),
    ...(adminToken ? { adminToken } : {}),
  };
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
        host: connect.host,
        vaultId: connect.vaultId,
        // Without a read token bots use the read+write one; the Vault page warns.
        token: connect.readToken ?? connect.adminToken ?? "",
        writable: false,
      }),
    );
  }
  backends = map;
  return map;
}

/** Where new items go: 1Password when it can be written to, else the local backend. */
export function primaryBackend(): BackendName {
  return connectConfig()?.adminToken ? "onepassword-connect" : "local";
}

/** Test seam: substitute backends (fakes, or Connect against a fake server). */
export function setReadBackendsForTests(map: Map<BackendName, VaultBackend> | undefined): void {
  backends = map;
}
