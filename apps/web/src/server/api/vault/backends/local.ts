/**
 * The `local` vault backend (issue #56): values sealed with SECRETS_KEY
 * (`crypto/secret-box.ts`, purpose `vault-local`) in the app's KV store.
 * The fallback when no external manager is configured, and where connection
 * header secrets move when the owner turns them into vault items.
 *
 * Each item is bound to its KV key and to the digest of its row's policy
 * (issue #179): reads pass the digest computed from the row, so widening an
 * item's hosts or origins in the database without the service leaves the
 * value unreadable. The digest an item was last sealed under is kept beside
 * it, only so an item no row links yet can still be listed and rotated.
 */
import { randomUUID } from "node:crypto";
import { createNamespaceKv } from "@groot/core/kv";
import { SecretValue, type VaultKind } from "@tiny-agents/agent";
import {
  hasSecretsKey,
  needsReseal,
  openJson,
  SecretLockedError,
  sealJson,
  type SecretBinding,
} from "../../../crypto/secret-box";
import { parseTotp, totpCode } from "../vault.totp";
import { cardBrand } from "./onepassword-mapping";
import {
  BackendError,
  type BackendItemSummary,
  type ItemDraft,
  type ValueField,
  type VaultBackend,
} from "./types";

interface StoredItem {
  kind: VaultKind;
  title: string;
  urls: string[];
  values: Partial<Record<ValueField, string>>;
  updatedAt: string;
}

/** What the KV store holds per item: the sealed item and the digest it is bound to. */
interface StoredEntry {
  policy: string;
  sealed: string;
}

const binding = (externalId: string, policy: string): SecretBinding => ({
  purpose: "vault-local",
  record: externalId,
  field: "item",
  policy,
});

function seal(externalId: string, item: StoredItem, policy: string): string {
  const entry: StoredEntry = { policy, sealed: sealJson(item, binding(externalId, policy)) };
  return JSON.stringify(entry);
}

function parseEntry(raw: string): StoredEntry {
  try {
    const entry = JSON.parse(raw) as Partial<StoredEntry>;
    if (typeof entry.policy === "string" && typeof entry.sealed === "string") {
      return { policy: entry.policy, sealed: entry.sealed };
    }
  } catch {
    // fall through
  }
  throw new BackendError("failed", "The local item is in an unknown format. Re-enter it.");
}

/** Item ids, so listing doesn't need a KV scan. */
const INDEX_KEY = "__index";

export interface LocalStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

function kvStore(): LocalStore {
  const kv = createNamespaceKv("VAULT_LOCAL");
  return {
    get: async (key) => (await kv.get<string>(key)) ?? undefined,
    set: async (key, value) => {
      await kv.set(key, value);
    },
    delete: async (key) => {
      await kv.delete(key);
    },
  };
}

function summarize(externalId: string, item: StoredItem): BackendItemSummary {
  const number = item.values.card_number;
  return {
    externalId,
    title: item.title,
    kind: item.kind,
    urls: item.urls,
    ...(item.values.username ? { username: item.values.username } : {}),
    ...(number
      ? {
          card: {
            brand: cardBrand(number),
            last4: number.replace(/\D/g, "").slice(-4),
            expiry: item.values.card_expiry ?? "",
          },
        }
      : {}),
    hasTotp: Boolean(item.values.totp),
    fields: (Object.keys(item.values) as ValueField[]).filter((field) => item.values[field]),
    updatedAt: item.updatedAt,
  };
}

export function createLocalBackend(store: LocalStore = kvStore()): VaultBackend {
  /** The item, opened under `policy` (the row's digest), or the stored one for an unlinked item. */
  const read = async (externalId: string, policy?: string): Promise<StoredItem> => {
    if (!hasSecretsKey()) throw new BackendError("unconfigured", "SECRETS_KEY is not set.");
    const raw = await store.get(externalId);
    if (!raw) throw new BackendError("not_found", "Item not found in the local vault.");
    const entry = parseEntry(raw);
    try {
      return openJson<StoredItem>(entry.sealed, binding(externalId, policy ?? entry.policy))!;
    } catch (error) {
      if (error instanceof SecretLockedError) throw new BackendError("failed", error.message);
      throw error;
    }
  };
  const index = async (): Promise<string[]> => JSON.parse((await store.get(INDEX_KEY)) ?? "[]");

  return {
    name: "local",
    capabilities: { create: true, update: true, delete: true, reveal: true },
    async status() {
      return hasSecretsKey()
        ? { state: "ready", detail: "Encrypted with SECRETS_KEY" }
        : { state: "unconfigured", detail: "Set SECRETS_KEY to use the local vault." };
    },
    async listCandidates() {
      if (!hasSecretsKey()) return [];
      const ids = await index();
      return Promise.all(ids.map(async (id) => summarize(id, await read(id))));
    },
    async describe(externalId, policy) {
      return summarize(externalId, await read(externalId, policy));
    },
    async resolve(externalId, field, policy) {
      const item = await read(externalId, policy);
      const value = item.values[field];
      if (!value) throw new BackendError("missing_field", `The item has no ${field}.`);
      if (field === "totp") {
        const spec = parseTotp(value);
        if (!spec)
          throw new BackendError(
            "missing_field",
            "The item's one-time password is not a TOTP seed.",
          );
        return new SecretValue(totpCode(spec));
      }
      return new SecretValue(value);
    },
    async create(draft: ItemDraft, policy = "") {
      if (!hasSecretsKey()) throw new BackendError("unconfigured", "SECRETS_KEY is not set.");
      const id = randomUUID();
      const item: StoredItem = {
        kind: draft.kind,
        title: draft.title,
        urls: draft.urls ?? [],
        values: Object.fromEntries(Object.entries(draft.values).filter(([, v]) => v)),
        updatedAt: new Date().toISOString(),
      };
      await store.set(id, seal(id, item, policy));
      await store.set(INDEX_KEY, JSON.stringify([...(await index()), id]));
      return id;
    },
    async update(externalId, draft, policy) {
      const item = await read(externalId, policy);
      const values = { ...item.values };
      for (const [field, value] of Object.entries(draft.values ?? {}) as [ValueField, string][]) {
        if (value === "") delete values[field];
        else if (value !== undefined) values[field] = value;
      }
      const next: StoredItem = {
        ...item,
        ...(draft.title !== undefined ? { title: draft.title } : {}),
        ...(draft.urls !== undefined ? { urls: draft.urls } : {}),
        values,
        updatedAt: new Date().toISOString(),
      };
      await store.set(
        externalId,
        seal(externalId, next, policy ?? parseEntry((await store.get(externalId))!).policy),
      );
    },
    async rebind(externalId, from, to) {
      await store.set(externalId, seal(externalId, await read(externalId, from), to));
    },
    async remove(externalId) {
      await store.delete(externalId);
      await store.set(INDEX_KEY, JSON.stringify((await index()).filter((id) => id !== externalId)));
    },
  };
}

/**
 * Rewrite every local item still sealed under SECRETS_KEY_PREVIOUS under the
 * current key (`pnpm secrets:rotate`). Returns how many it rewrote.
 */
export async function resealLocalItems(store: LocalStore = kvStore()): Promise<number> {
  const ids: string[] = JSON.parse((await store.get(INDEX_KEY)) ?? "[]");
  const resealed = await Promise.all(
    ids.map(async (id) => {
      const raw = await store.get(id);
      if (!raw) return false;
      const entry = parseEntry(raw);
      if (!needsReseal(entry.sealed, "vault-local")) return false;
      const item = openJson<StoredItem>(entry.sealed, binding(id, entry.policy))!;
      // Skip an item the owner changed meanwhile: its new value is already current.
      if ((await store.get(id)) !== raw) return false;
      await store.set(id, seal(id, item, entry.policy));
      return true;
    }),
  );
  return resealed.filter(Boolean).length;
}
