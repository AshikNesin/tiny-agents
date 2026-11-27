import { app } from "../../../app-root";
import { appEnv } from "../../../env";
import { createOnePasswordBackend, type OnePasswordConnector } from "./onepassword";
import { createLocalBackend } from "./local";
import type { BackendName, VaultBackend } from "./types";

export interface OnePasswordConfig {
  vaultId?: string;
  readToken?: string;
  adminToken?: string;
}

const unquote = (value: string | undefined) =>
  value
    ?.trim()
    .replace(/^(['"])([\s\S]*)\1$/, "$2")
    .trim() || undefined;

export function onePasswordConfig(): OnePasswordConfig | undefined {
  const env = appEnv();
  const readToken = unquote(env.OP_SERVICE_ACCOUNT_TOKEN);
  const adminToken = unquote(env.OP_SERVICE_ACCOUNT_ADMIN_TOKEN);
  if (!readToken && !adminToken) return undefined;
  const vaultId = unquote(env.OP_VAULT_ID);
  return {
    ...(vaultId ? { vaultId } : {}),
    ...(readToken ? { readToken } : {}),
    ...(adminToken ? { adminToken } : {}),
  };
}

let backends: Map<BackendName, VaultBackend> | undefined;

export function onePasswordBackend(
  config: OnePasswordConfig,
  token: string,
  writable: boolean,
): VaultBackend {
  const connector = app().vault.onePasswordConnector;
  return createOnePasswordBackend({
    token,
    writable,
    ...(config.vaultId ? { vaultId: config.vaultId } : {}),
    ...(connector ? { connect: connector } : {}),
  });
}

export function readBackends(): Map<BackendName, VaultBackend> {
  if (backends) return backends;
  const map = new Map<BackendName, VaultBackend>([["local", createLocalBackend()]]);
  const onePassword = onePasswordConfig();
  if (onePassword) {
    map.set(
      "onepassword",
      onePasswordBackend(onePassword, onePassword.readToken ?? onePassword.adminToken ?? "", false),
    );
  }
  backends = map;
  return map;
}

export function primaryBackend(): BackendName {
  return onePasswordConfig()?.adminToken ? "onepassword" : "local";
}

export function setReadBackendsForTests(map: Map<BackendName, VaultBackend> | undefined): void {
  backends = map;
}

export function setOnePasswordConnectorForTests(fake: OnePasswordConnector | undefined): void {
  app().vault.onePasswordConnector = fake;
}
