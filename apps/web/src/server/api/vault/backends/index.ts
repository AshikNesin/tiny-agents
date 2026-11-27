import { app } from "../../../app-root";
import { appEnv } from "../../../env";
import { createOnePasswordBackend, type OnePasswordConnector } from "./onepassword";
import { createLocalBackend } from "./local";
import type { BackendName, VaultBackend } from "./types";

interface OnePasswordConfig {
  vaultId?: string;
  readToken?: string;
  adminToken?: string;
}

const unquote = (value: string | undefined) =>
  value
    ?.trim()
    .replace(/^(['"])([\s\S]*)\1$/, "$2")
    .trim() || undefined;

function onePasswordConfig(): OnePasswordConfig | undefined {
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

function onePasswordBackend(
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

function buildBackends() {
  const local = createLocalBackend();
  const read = new Map<BackendName, VaultBackend>([["local", local]]);
  const write = new Map<BackendName, VaultBackend>([["local", local]]);
  const onePassword = onePasswordConfig();
  if (onePassword) {
    const readToken = onePassword.readToken ?? onePassword.adminToken ?? "";
    const writeToken = onePassword.adminToken ?? onePassword.readToken ?? "";
    read.set("onepassword", onePasswordBackend(onePassword, readToken, false));
    write.set(
      "onepassword",
      onePasswordBackend(onePassword, writeToken, Boolean(onePassword.adminToken)),
    );
  }
  return { read, write };
}

function backends() {
  const vault = app().vault;
  vault.backends ??= buildBackends();
  return vault.backends;
}

export function readBackends(): Map<BackendName, VaultBackend> {
  return backends().read;
}

export function writeBackends(): Map<BackendName, VaultBackend> {
  return backends().write;
}

export function primaryBackend(): BackendName {
  return onePasswordConfig()?.adminToken ? "onepassword" : "local";
}

export function setVaultBackendsForTests(map: Map<BackendName, VaultBackend> | undefined): void {
  const vault = app().vault;
  vault.backends = map ? { read: map, write: map } : undefined;
  vault.candidates = undefined;
}

export function setOnePasswordConnectorForTests(fake: OnePasswordConnector | undefined): void {
  app().vault.onePasswordConnector = fake;
}
