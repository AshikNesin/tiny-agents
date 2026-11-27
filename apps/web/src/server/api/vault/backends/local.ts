import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { SecretValue, type VaultKind } from "@tiny-agents/agent";
import { logger } from "@groot/core/logger";
import { appEnv } from "../../../env";
import { db, vaultItems, vaultValues, type VaultValue } from "../../../db";
import {
  hasSecretsKey,
  needsReseal,
  openJson,
  SecretLockedError,
  sealJson,
  secretKeyProblem,
  type SecretBinding,
} from "../../../crypto/secret-box";
import { parseTotp, totpCode } from "../vault.totp";
import { vaultPolicyDigest, type PolicyColumns } from "../vault.policy";
import {
  BackendError,
  type BackendItemSummary,
  type CandidateListing,
  type DbTx,
  type ItemDraft,
  type ValueField,
  type VaultBackend,
} from "./types";

export function cardBrand(number: string): string {
  const digits = number.replace(/\D/g, "");
  if (digits.startsWith("4")) return "Visa";
  if (/^(5[1-5]|2[2-7])/.test(digits)) return "Mastercard";
  if (/^3[47]/.test(digits)) return "Amex";
  if (/^6(011|5)/.test(digits)) return "Discover";
  if (digits.startsWith("35")) return "JCB";
  if (/^3(0[0-5]|[68])/.test(digits)) return "Diners";
  return "Card";
}

interface StoredItem {
  kind: VaultKind;
  title: string;
  urls: string[];
  values: Partial<Record<ValueField, string>>;
  updatedAt: string;
}

const binding = (id: string, policy: string): SecretBinding => ({
  purpose: "vault-local",
  record: id,
  field: "item",
  policy,
});

const UNREADABLE = "The stored secret doesn't match its record or policy. Re-enter it.";

function linksOf(tx: DbTx, id: string): PolicyColumns[] {
  return tx
    .select({
      audience: vaultItems.audience,
      originsJson: vaultItems.originsJson,
      hostsJson: vaultItems.hostsJson,
      injectJson: vaultItems.injectJson,
    })
    .from(vaultItems)
    .where(and(eq(vaultItems.backend, "local"), eq(vaultItems.externalId, id)))
    .all();
}

function authority(row: Pick<VaultValue, "policy">, links: PolicyColumns[]): string {
  if (links.length === 0) return row.policy;
  const digests = new Set(links.map(vaultPolicyDigest));
  const [digest] = digests;
  if (digests.size > 1 || digest !== row.policy) throw new BackendError("failed", UNREADABLE);
  return digest!;
}

function openRow(row: VaultValue, links: PolicyColumns[]): StoredItem {
  const policy = authority(row, links);
  try {
    return openJson<StoredItem>(row.sealed, binding(row.id, policy))!;
  } catch (error) {
    if (error instanceof SecretLockedError) throw new BackendError("failed", error.message);
    throw error;
  }
}

function requireKey(): void {
  if (!hasSecretsKey()) throw new BackendError("unconfigured", "SECRETS_KEY is not set.");
  const problem = secretKeyProblem(appEnv().SECRETS_KEY);
  if (problem) throw new BackendError("unconfigured", problem);
}

function rowOf(tx: DbTx, id: string): VaultValue {
  const row = tx.select().from(vaultValues).where(eq(vaultValues.id, id)).get();
  if (!row) throw new BackendError("not_found", "Item not found in the local vault.");
  return row;
}

function readItem(tx: DbTx, id: string): StoredItem {
  requireKey();
  return openRow(rowOf(tx, id), linksOf(tx, id));
}

export function localItemValues(tx: DbTx, id: string): Partial<Record<ValueField, string>> {
  return readItem(tx, id).values;
}

export function replaceLocalItem(tx: DbTx, id: string, draft: ItemDraft, policy: string): void {
  requireKey();
  const sealed = sealJson(storedItem(draft), binding(id, policy));
  tx.insert(vaultValues)
    .values({ id, sealed, policy })
    .onConflictDoUpdate({ target: vaultValues.id, set: { sealed, policy } })
    .run();
}

function storedItem(draft: ItemDraft): StoredItem {
  return {
    kind: draft.kind,
    title: draft.title,
    urls: draft.urls ?? [],
    values: Object.fromEntries(Object.entries(draft.values).filter(([, v]) => v)),
    updatedAt: new Date().toISOString(),
  };
}

export function insertLocalItem(tx: DbTx, draft: ItemDraft, policy = ""): string {
  requireKey();
  const id = randomUUID();
  tx.insert(vaultValues)
    .values({ id, sealed: sealJson(storedItem(draft), binding(id, policy)), policy })
    .run();
  return id;
}

function writeLocalItem(tx: DbTx, id: string, draft: Partial<ItemDraft>): void {
  const row = rowOf(tx, id);
  requireKey();
  const item = openRow(row, linksOf(tx, id));
  const values = { ...item.values };
  for (const [field, value] of Object.entries(draft.values ?? {}) as [ValueField, string][]) {
    if (value === "") delete values[field];
    else if (value !== undefined) values[field] = value;
  }
  const changed =
    draft.values !== undefined || draft.title !== undefined || draft.urls !== undefined;
  const next: StoredItem = {
    ...item,
    ...(draft.title !== undefined ? { title: draft.title } : {}),
    ...(draft.urls !== undefined ? { urls: draft.urls } : {}),
    values,
    ...(changed ? { updatedAt: new Date().toISOString() } : {}),
  };
  tx.update(vaultValues)
    .set({ sealed: sealJson(next, binding(id, row.policy)) })
    .where(eq(vaultValues.id, id))
    .run();
}

export function readLocalDraft(externalId: string): ItemDraft {
  const item = readItem(db, externalId);
  return { kind: item.kind, title: item.title, urls: item.urls, values: item.values };
}

export function deleteLocalItem(tx: DbTx, id: string): void {
  tx.delete(vaultValues).where(eq(vaultValues.id, id)).run();
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

function listItems(): CandidateListing {
  const rows = db
    .select()
    .from(vaultValues)
    .orderBy(sql`rowid`)
    .all();
  const links = new Map<string, PolicyColumns[]>();
  for (const link of db
    .select({
      externalId: vaultItems.externalId,
      audience: vaultItems.audience,
      originsJson: vaultItems.originsJson,
      hostsJson: vaultItems.hostsJson,
      injectJson: vaultItems.injectJson,
    })
    .from(vaultItems)
    .where(eq(vaultItems.backend, "local"))
    .all()) {
    links.set(link.externalId, [...(links.get(link.externalId) ?? []), link]);
  }
  const listing: CandidateListing = { items: [], unreadable: [] };
  for (const row of rows) {
    try {
      listing.items.push(summarize(row.id, openRow(row, links.get(row.id) ?? [])));
    } catch (error) {
      listing.unreadable.push({ externalId: row.id, reason: (error as Error).message });
    }
  }
  return listing;
}

export function createLocalBackend(): VaultBackend {
  return {
    name: "local",
    capabilities: { create: true, update: true, delete: true, reveal: true },
    async status() {
      return hasSecretsKey()
        ? { state: "ready", detail: "Encrypted with SECRETS_KEY" }
        : { state: "unconfigured", detail: "Set SECRETS_KEY to use the local vault." };
    },
    async listCandidates() {
      if (!hasSecretsKey()) return { items: [], unreadable: [] };
      return listItems();
    },
    async describe(externalId) {
      return summarize(externalId, readItem(db, externalId));
    },
    async resolve(externalId, field) {
      const item = readItem(db, externalId);
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
    async create(draft, policy = "") {
      const externalId = insertLocalItem(db, draft, policy);
      return { externalId, summary: summarize(externalId, readItem(db, externalId)) };
    },
    async update(externalId, draft) {
      db.transaction((tx) => writeLocalItem(tx, externalId, draft));
    },
    async rebind(externalId, writeRow) {
      return db.transaction((tx) => {
        const row = rowOf(tx, externalId);
        let opened: { item: StoredItem } | { error: unknown };
        try {
          requireKey();
          opened = { item: openRow(row, linksOf(tx, externalId)) };
        } catch (error) {
          opened = { error };
        }
        const written = writeRow(tx);
        const policy = vaultPolicyDigest(written);
        if (policy !== row.policy) {
          if ("error" in opened) throw opened.error;
          const { item } = opened;
          tx.update(vaultValues)
            .set({ sealed: sealJson(item, binding(externalId, policy)), policy })
            .where(eq(vaultValues.id, externalId))
            .run();
        }
        return written;
      });
    },
    async remove(externalId) {
      deleteLocalItem(db, externalId);
    },
  };
}

export function resealLocalItems(): { resealed: number; skipped: string[] } {
  const ids = db.select({ id: vaultValues.id }).from(vaultValues).all();
  let resealed = 0;
  const skipped: string[] = [];
  for (const { id } of ids) {
    try {
      const done = db.transaction((tx) => {
        const row = tx.select().from(vaultValues).where(eq(vaultValues.id, id)).get();
        if (!row || !needsReseal(row.sealed, "vault-local")) return false;
        writeLocalItem(tx, id, {});
        return true;
      });
      if (done) resealed += 1;
    } catch (error) {
      skipped.push(id);
      logger.warn({ item: id, error: (error as Error).message }, "Vault item not re-sealed");
    }
  }
  return { resealed, skipped };
}
