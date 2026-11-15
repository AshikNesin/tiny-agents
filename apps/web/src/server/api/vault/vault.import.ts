/**
 * The one-time move of stored secrets into the vault's tables (Q4), run at
 * every start (and by `pnpm secrets:rotate`) until there is nothing left.
 *
 * - **Vault values.** Before Q4 the local backend kept each item in the KV
 *   store as `VAULT_LOCAL:<id>` (`{policy, sealed}`), listed by a hand-kept
 *   `VAULT_LOCAL:__index`. Every `VAULT_LOCAL:` entry is copied byte for byte
 *   into `vault_values` (same id, same ciphertext, same policy digest: the
 *   AAD is unchanged, so nothing is re-encrypted), read back, and only then
 *   deleted from KV. An entry already in the table is the table's: its KV copy
 *   is stale and is deleted. An entry that isn't in the old format is left
 *   in KV and reported, and so is the index while anything is left; the rest
 *   move. The scan reads every key, so an item a lost `__index` write dropped
 *   (C11) moves too.
 * - **Connection header values.** A connection's `secret_enc` is opened and
 *   written as its own vault item (`connection-secrets.ts`), checked, and
 *   cleared, in one transaction. One that can't be opened (no SECRETS_KEY, a
 *   different key) stays where it is and is reported; the next start tries
 *   again.
 *
 * Idempotent: a second run finds nothing to move. Never throws for one bad
 * entry; boot never fails because of it.
 */
import { eq, isNotNull, sql } from "drizzle-orm";
import { logger } from "@groot/core/logger";
import { connections, db, kv, vaultItems, vaultValues, type Connection } from "../../db";
import { hasSecretsKey } from "../../crypto/secret-box";
import { openHeaderSecret, writeOwnHeaderSecret } from "../connections/connection-secrets";
import { localItemValues } from "./backends/local";
import { vaultItemsChanged } from "./vault.admin.service";

const PREFIX = "VAULT_LOCAL:";
const INDEX_KEY = `${PREFIX}__index`;

interface Problem {
  id: string;
  reason: string;
}

export interface VaultImportReport {
  values: {
    /** Moved into `vault_values` this run. */
    moved: string[];
    /** Already in the table; the stale KV copy was removed. */
    alreadyMoved: string[];
    /** Moved, but they don't open with the current keys (as before the move). */
    unreadable: Problem[];
    /** Left in KV: not in the old format, or named by the index with no entry. */
    failed: Problem[];
  };
  connections: {
    moved: string[];
    failed: Problem[];
  };
}

/** A pre-Q4 entry: `JSON.stringify(JSON.stringify({policy, sealed}))`. */
function parseEntry(raw: string): { policy: string; sealed: string } {
  let entry: unknown;
  try {
    const inner = JSON.parse(raw) as unknown;
    entry = typeof inner === "string" ? JSON.parse(inner) : undefined;
  } catch {
    // fall through
  }
  const { policy, sealed } = (entry ?? {}) as { policy?: unknown; sealed?: unknown };
  if (typeof policy !== "string" || typeof sealed !== "string" || !sealed.startsWith("v2:")) {
    throw new Error("not a vault entry in the pre-Q4 format");
  }
  return { policy, sealed };
}

function parseIndex(raw: string): string[] {
  try {
    const inner = JSON.parse(raw) as unknown;
    const ids = typeof inner === "string" ? (JSON.parse(inner) as unknown) : undefined;
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/** Move the KV store's vault entries into `vault_values`. */
export function importVaultValues(): VaultImportReport["values"] {
  const report: VaultImportReport["values"] = {
    moved: [],
    alreadyMoved: [],
    unreadable: [],
    failed: [],
  };
  const rows = db
    .select()
    .from(kv)
    .where(sql`substr(${kv.key}, 1, ${PREFIX.length}) = ${PREFIX}`)
    .all();
  if (rows.length === 0) return report;
  const entries = new Map<string, string>();
  let index: string[] = [];
  for (const row of rows) {
    if (row.key === INDEX_KEY) index = parseIndex(row.value);
    else entries.set(row.key.slice(PREFIX.length), row.value);
  }
  // Index order first (the order the old list showed), then any the index lost.
  const ids = [...new Set([...index.filter((id) => entries.has(id)), ...entries.keys()])];
  // One the index names that is in neither place was already lost before Q4.
  for (const id of index) {
    if (entries.has(id)) continue;
    if (db.select({ id: vaultValues.id }).from(vaultValues).where(eq(vaultValues.id, id)).get()) {
      continue;
    }
    report.failed.push({ id, reason: "named by __index, but has no entry" });
  }
  for (const id of ids) {
    let entry: { policy: string; sealed: string };
    try {
      entry = parseEntry(entries.get(id)!);
    } catch (error) {
      report.failed.push({ id, reason: (error as Error).message });
      continue;
    }
    let moved: boolean;
    try {
      moved = db.transaction((tx) => {
        if (
          tx.select({ id: vaultValues.id }).from(vaultValues).where(eq(vaultValues.id, id)).get()
        ) {
          tx.delete(kv)
            .where(eq(kv.key, `${PREFIX}${id}`))
            .run();
          return false;
        }
        tx.insert(vaultValues).values({ id, sealed: entry.sealed, policy: entry.policy }).run();
        const copy = tx.select().from(vaultValues).where(eq(vaultValues.id, id)).get();
        if (copy?.sealed !== entry.sealed || copy.policy !== entry.policy) {
          throw new Error("the copy doesn't match the entry");
        }
        tx.delete(kv)
          .where(eq(kv.key, `${PREFIX}${id}`))
          .run();
        return true;
      });
      (moved ? report.moved : report.alreadyMoved).push(id);
    } catch (error) {
      report.failed.push({ id, reason: (error as Error).message });
      continue;
    }
    // The move changes nothing about whether it opens; say so when it doesn't
    // (under its authority, as every read now opens it).
    if (moved && hasSecretsKey()) {
      try {
        localItemValues(db, id);
      } catch (error) {
        report.unreadable.push({ id, reason: (error as Error).message });
      }
    }
  }
  // The index goes once every entry it named has a home.
  if (report.failed.length === 0) db.delete(kv).where(eq(kv.key, INDEX_KEY)).run();
  return report;
}

/** Move each connection's pre-Q4 header value into its own vault item. */
export function importConnectionSecrets(): VaultImportReport["connections"] {
  const report: VaultImportReport["connections"] = { moved: [], failed: [] };
  const rows = db.select().from(connections).where(isNotNull(connections.secretEnc)).all();
  for (const row of rows) {
    if (!hasSecretsKey()) {
      report.failed.push({ id: row.id, reason: "SECRETS_KEY is not set" });
      continue;
    }
    try {
      if (moveConnectionSecret(row)) report.moved.push(row.id);
    } catch (error) {
      report.failed.push({ id: row.id, reason: (error as Error).message });
    }
  }
  return report;
}

/**
 * Move one connection's `secret_enc` into its own vault item, read back and
 * checked, in one transaction. The row is read again inside it: when another
 * run (a boot and `secrets:rotate` at once) moved or changed it since `seen`
 * was read, this does nothing and returns false.
 */
export function moveConnectionSecret(seen: Connection): boolean {
  if (!seen.secretEnc) return false;
  const value = openHeaderSecret(seen.id, seen.secretEnc);
  return db.transaction((tx) => {
    const row = tx.select().from(connections).where(eq(connections.id, seen.id)).get();
    if (!row || row.secretEnc !== seen.secretEnc) return false;
    const itemId = writeOwnHeaderSecret(tx, row, value, "vault_import");
    // Read it back through its row before `secret_enc` is gone for good.
    const item = tx
      .select({ externalId: vaultItems.externalId })
      .from(vaultItems)
      .where(eq(vaultItems.id, itemId))
      .get();
    if (!item || localItemValues(tx, item.externalId).value !== value) {
      throw new Error("the vault item doesn't hold the value");
    }
    return true;
  });
}

/** Both moves, logged. For the boot and `pnpm secrets:rotate`. */
export function importStoredSecrets(): VaultImportReport {
  const report: VaultImportReport = {
    values: importVaultValues(),
    connections: importConnectionSecrets(),
  };
  const { values, connections: moved } = report;
  if (values.moved.length + moved.moved.length > 0) {
    vaultItemsChanged();
    logger.info(
      { values: values.moved.length, connections: moved.moved.length },
      "Moved stored secrets into the vault tables",
    );
  }
  if (values.failed.length + values.unreadable.length + moved.failed.length > 0) {
    logger.warn(
      { failed: values.failed, unreadable: values.unreadable, connections: moved.failed },
      "Some stored secrets were not moved, or don't open with the current SECRETS_KEY",
    );
  }
  return report;
}
