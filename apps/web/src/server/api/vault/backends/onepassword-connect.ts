/**
 * 1Password Connect over REST (issue #56): a plain `fetch` client, no binary.
 *
 * Connect runs as its own service (the Coolify internal network, or another
 * host reached over the tailnet) and decrypts there, so 1Password stays
 * zero-knowledge. Every path is pinned to the dedicated vault from env; an
 * item whose `vault.id` differs is refused. The guard (`status()`) lists the
 * vaults the token can see and refuses every use unless that list is exactly
 * the pinned vault — a token that can see another vault is never used.
 */
import { SecretValue } from "@tiny-agents/agent";
import { parseTotp, totpCode } from "../vault.totp";
import {
  applyDraft,
  findField,
  fromConnectValue,
  summarize,
  toConnectItem,
  type ConnectItem,
} from "./onepassword-mapping";
import {
  BackendError,
  type BackendItemSummary,
  type BackendStatus,
  type ItemDraft,
  type ValueField,
  type VaultBackend,
} from "./types";

export interface ConnectOptions {
  host: string;
  vaultId: string;
  token: string;
  /** Read-only tokens get no write methods. */
  writable: boolean;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** The guard re-runs this often (and on every token change, i.e. boot). */
const GUARD_TTL_MS = 6 * 60 * 60_000;

export function createConnectBackend(options: ConnectOptions): VaultBackend & {
  /** Expiry of the token when it is a JWT with an `exp` claim. */
  tokenExpiresAt(): Date | undefined;
} {
  const base = options.host.replace(/\/+$/, "");
  const doFetch = options.fetch ?? fetch;
  const vault = encodeURIComponent(options.vaultId);
  let guard: { at: number; status: BackendStatus } | undefined;

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await doFetch(`${base}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${options.token}`,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
      });
    } catch {
      throw new BackendError("unreachable", "The 1Password Connect server is unreachable.");
    }
    if (response.status === 401 || response.status === 403) {
      throw new BackendError(
        "unauthorized",
        "1Password Connect refused the token (expired, revoked or without access).",
      );
    }
    if (response.status === 404)
      throw new BackendError("not_found", "Item not found in 1Password.");
    if (!response.ok) {
      throw new BackendError("failed", `1Password Connect answered ${response.status}.`);
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  async function checkScope(): Promise<BackendStatus> {
    if (!options.host || !options.vaultId || !options.token) {
      return {
        state: "unconfigured",
        detail: "Set OP_CONNECT_HOST, OP_CONNECT_VAULT_ID and the token.",
      };
    }
    try {
      const vaults = await call<{ id: string; name?: string }[]>("GET", "/v1/vaults");
      const extra = vaults.filter((v) => v.id !== options.vaultId);
      const pinned = vaults.some((v) => v.id === options.vaultId);
      if (extra.length > 0 || !pinned) {
        return {
          state: "error",
          code: "token_overscoped",
          detail: pinned
            ? "The token can see vaults besides the pinned one; every use is refused."
            : "The token cannot see the pinned vault.",
          extraVaults: extra.map((v) => v.name ?? v.id),
        };
      }
      return { state: "ready", detail: "1 vault visible" };
    } catch (error) {
      const code = error instanceof BackendError ? error.code : "failed";
      return { state: "error", code, detail: (error as Error).message };
    }
  }

  async function status(force = false): Promise<BackendStatus> {
    if (!force && guard && Date.now() - guard.at < GUARD_TTL_MS && guard.status.state === "ready") {
      return guard.status;
    }
    guard = { at: Date.now(), status: await checkScope() };
    return guard.status;
  }

  async function ready(): Promise<void> {
    const current = await status();
    if (current.state === "ready") return;
    throw new BackendError(
      current.code === "token_overscoped" ? "token_overscoped" : "unconfigured",
      current.detail ?? "The vault backend is not ready.",
    );
  }

  async function getItem(externalId: string): Promise<ConnectItem> {
    await ready();
    const item = await call<ConnectItem>(
      "GET",
      `/v1/vaults/${vault}/items/${encodeURIComponent(externalId)}`,
    );
    if (item.vault?.id !== options.vaultId) {
      throw new BackendError("not_found", "Item not found in the pinned vault.");
    }
    return item;
  }

  const backend: VaultBackend & { tokenExpiresAt(): Date | undefined } = {
    name: "onepassword-connect",
    capabilities: {
      create: options.writable,
      update: options.writable,
      delete: options.writable,
      reveal: true,
    },
    status: () => status(true),
    tokenExpiresAt() {
      const payload = options.token.split(".")[1];
      if (!payload) return undefined;
      try {
        const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
          exp?: number;
        };
        return typeof claims.exp === "number" ? new Date(claims.exp * 1000) : undefined;
      } catch {
        return undefined;
      }
    },
    async listCandidates(): Promise<BackendItemSummary[]> {
      await ready();
      const items = await call<ConnectItem[]>("GET", `/v1/vaults/${vault}/items`);
      return items
        .filter((item) => item.vault?.id === options.vaultId)
        .map((item) => summarize(item));
    },
    async describe(externalId) {
      return summarize(await getItem(externalId));
    },
    async resolve(externalId: string, field: ValueField): Promise<SecretValue> {
      const item = await getItem(externalId);
      const found = findField(item, field);
      if (field === "totp") {
        const spec = found?.value ? parseTotp(found.value) : undefined;
        if (spec) return new SecretValue(totpCode(spec));
        if (found?.totp) return new SecretValue(found.totp);
        throw new BackendError("missing_field", "The item has no one-time password.");
      }
      if (!found?.value) throw new BackendError("missing_field", `The item has no ${field}.`);
      return new SecretValue(fromConnectValue(field, found.value));
    },
  };

  if (options.writable) {
    backend.create = async (draft: ItemDraft) => {
      await ready();
      const created = await call<ConnectItem>(
        "POST",
        `/v1/vaults/${vault}/items`,
        toConnectItem(draft, options.vaultId),
      );
      if (!created.id) throw new BackendError("failed", "1Password did not return the new item.");
      return created.id;
    };
    backend.update = async (externalId, draft) => {
      // Read-modify-write of the whole item keeps fields the vault doesn't model.
      const item = await getItem(externalId);
      const next = applyDraft(item, draft);
      next.vault = { id: options.vaultId };
      await call("PUT", `/v1/vaults/${vault}/items/${encodeURIComponent(externalId)}`, next);
    };
    backend.remove = async (externalId) => {
      await getItem(externalId);
      await call("DELETE", `/v1/vaults/${vault}/items/${encodeURIComponent(externalId)}`);
    };
  }
  return backend;
}
