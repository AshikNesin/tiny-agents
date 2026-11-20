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
  type BackendStatus,
  type ItemDraft,
  type ValueField,
  type VaultBackend,
} from "./types";

export interface ConnectOptions {
  host: string;
  vaultId?: string;
  token: string;
  writable: boolean;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

const GUARD_TTL_MS = 6 * 60 * 60_000;
const EXPIRY_WARNING_MS = 14 * 86_400_000;

function tokenExpiresAt(token: string): Date | undefined {
  const payload = token.split(".")[1];
  if (!payload) return undefined;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      exp?: number;
    };
    return typeof claims.exp === "number" ? new Date(claims.exp * 1000) : undefined;
  } catch {
    return undefined;
  }
}

function expiryNote(token: string, now = Date.now()): string {
  const at = tokenExpiresAt(token);
  if (!at) return "";
  const left = at.getTime() - now;
  if (left < 0) return " The token has expired.";
  if (left > EXPIRY_WARNING_MS) return "";
  const days = Math.floor(left / 86_400_000);
  return ` The token expires in ${days} day${days === 1 ? "" : "s"}.`;
}

export function createConnectBackend(options: ConnectOptions): VaultBackend {
  const base = options.host.replace(/\/+$/, "");
  const doFetch = options.fetch ?? fetch;
  let guard: { at: number; status: BackendStatus; vaultId?: string } | undefined;

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

  async function checkScope(): Promise<{ status: BackendStatus; vaultId?: string }> {
    if (!options.token) {
      return { status: { state: "unconfigured", detail: "Set the Connect token." } };
    }
    try {
      const vaults = await call<{ id: string; name?: string }[]>("GET", "/v1/vaults");
      const pin = options.vaultId ?? (vaults.length === 1 ? vaults[0]!.id : undefined);
      const extra = vaults.filter((v) => v.id !== pin);
      const pinned = vaults.find((v) => v.id === pin);
      if (!pinned || extra.length > 0) {
        const names = extra.map((v) => v.name ?? v.id).join(", ");
        return {
          status: {
            state: "error",
            code: "token_overscoped",
            detail: !pinned
              ? options.vaultId
                ? "The token cannot see the pinned vault."
                : `The token must see exactly one vault; it sees ${vaults.length}.`
              : `The token can see vaults besides the pinned one (${names}); every use is refused.`,
          },
        };
      }
      return {
        status: {
          state: "ready",
          detail: `Vault "${pinned.name ?? pinned.id}".${expiryNote(options.token)}`,
        },
        vaultId: pinned.id,
      };
    } catch (error) {
      const code = error instanceof BackendError ? error.code : "failed";
      return { status: { state: "error", code, detail: (error as Error).message } };
    }
  }

  async function status(force = false): Promise<BackendStatus> {
    if (!force && guard && Date.now() - guard.at < GUARD_TTL_MS && guard.status.state === "ready") {
      return guard.status;
    }
    guard = { at: Date.now(), ...(await checkScope()) };
    return guard.status;
  }

  async function ready(): Promise<string> {
    const current = await status();
    if (current.state === "ready" && guard?.vaultId) return guard.vaultId;
    throw new BackendError(
      current.code === "token_overscoped" ? "token_overscoped" : "unconfigured",
      current.detail ?? "The vault backend is not ready.",
    );
  }

  const itemPath = (vaultId: string, externalId?: string) =>
    `/v1/vaults/${encodeURIComponent(vaultId)}/items${
      externalId === undefined ? "" : `/${encodeURIComponent(externalId)}`
    }`;

  async function getItem(externalId: string): Promise<{ item: ConnectItem; vaultId: string }> {
    const vaultId = await ready();
    const item = await call<ConnectItem>("GET", itemPath(vaultId, externalId));
    if (item.vault?.id !== vaultId) {
      throw new BackendError("not_found", "Item not found in the pinned vault.");
    }
    return { item, vaultId };
  }

  const backend: VaultBackend = {
    name: "onepassword-connect",
    capabilities: {
      create: options.writable,
      update: options.writable,
      delete: options.writable,
      reveal: true,
    },
    status: () => status(true),
    async listCandidates() {
      const vaultId = await ready();
      const items = await call<ConnectItem[]>("GET", itemPath(vaultId));
      return {
        items: items.filter((item) => item.vault?.id === vaultId).map((item) => summarize(item)),
        unreadable: [],
      };
    },
    async describe(externalId) {
      return summarize((await getItem(externalId)).item);
    },
    async resolve(externalId: string, field: ValueField): Promise<SecretValue> {
      const { item } = await getItem(externalId);
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
      const vaultId = await ready();
      const created = await call<ConnectItem>(
        "POST",
        itemPath(vaultId),
        toConnectItem(draft, vaultId),
      );
      if (!created.id) throw new BackendError("failed", "1Password did not return the new item.");
      return created.id;
    };
    backend.update = async (externalId, draft) => {
      const { item, vaultId } = await getItem(externalId);
      const next = applyDraft(item, draft);
      next.vault = { id: vaultId };
      await call("PUT", itemPath(vaultId, externalId), next);
    };
    backend.remove = async (externalId) => {
      const { vaultId } = await getItem(externalId);
      await call("DELETE", itemPath(vaultId, externalId));
    };
  }
  return backend;
}
