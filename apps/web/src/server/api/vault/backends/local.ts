/**
 * The `local` vault backend (issue #56): values AES-256-GCM encrypted with
 * SECRETS_KEY (`connections/secrets.ts`) in the app's KV store. The fallback
 * when no external manager is configured, and where connection header
 * secrets move when the owner turns them into vault items.
 */
import { randomUUID } from "node:crypto";
import { createNamespaceKv } from "@groot/core/kv";
import { SecretValue, type VaultKind } from "@tiny-agents/agent";
import { decryptJson, encryptJson, hasSecretsKey } from "../../connections/secrets";
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
  const read = async (externalId: string): Promise<StoredItem> => {
    if (!hasSecretsKey()) throw new BackendError("unconfigured", "SECRETS_KEY is not set.");
    const raw = await store.get(externalId);
    if (!raw) throw new BackendError("not_found", "Item not found in the local vault.");
    return decryptJson<StoredItem>(raw, undefined as never);
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
    async describe(externalId) {
      return summarize(externalId, await read(externalId));
    },
    async resolve(externalId, field) {
      const item = await read(externalId);
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
    async create(draft: ItemDraft) {
      if (!hasSecretsKey()) throw new BackendError("unconfigured", "SECRETS_KEY is not set.");
      const id = randomUUID();
      const item: StoredItem = {
        kind: draft.kind,
        title: draft.title,
        urls: draft.urls ?? [],
        values: Object.fromEntries(Object.entries(draft.values).filter(([, v]) => v)),
        updatedAt: new Date().toISOString(),
      };
      await store.set(id, encryptJson(item));
      await store.set(INDEX_KEY, JSON.stringify([...(await index()), id]));
      return id;
    },
    async update(externalId, draft) {
      const item = await read(externalId);
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
      await store.set(externalId, encryptJson(next));
    },
    async remove(externalId) {
      await store.delete(externalId);
      await store.set(INDEX_KEY, JSON.stringify((await index()).filter((id) => id !== externalId)));
    },
  };
}
