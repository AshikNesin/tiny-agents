import { appEnv } from "../../../env";
import { BUNDLED_CONNECT_HOST, bundledConnectWanted } from "../connect/bundled-connect";
import { createConnectBackend } from "./onepassword-connect";
import { createLocalBackend } from "./local";
import type { BackendName, VaultBackend } from "./types";

export interface ConnectConfig {
  host: string;
  vaultId?: string;
  bundled: boolean;
  readToken?: string;
  adminToken?: string;
}

const unquote = (value: string | undefined) =>
  value
    ?.trim()
    .replace(/^(['"])([\s\S]*)\1$/, "$2")
    .trim() || undefined;

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
        token: connect.readToken ?? connect.adminToken ?? "",
        writable: false,
      }),
    );
  }
  backends = map;
  return map;
}

export function primaryBackend(): BackendName {
  return connectConfig()?.adminToken ? "onepassword-connect" : "local";
}

export function setReadBackendsForTests(map: Map<BackendName, VaultBackend> | undefined): void {
  backends = map;
}
