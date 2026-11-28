import { parseJson } from "@tiny-agents/std";
import { z } from "zod";
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
    moved: string[];
    alreadyMoved: string[];
    unreadable: Problem[];
    failed: Problem[];
  };
  connections: {
    moved: string[];
    failed: Problem[];
  };
}

const entrySchema = z.looseObject({ policy: z.string(), sealed: z.string().startsWith("v2:") });

function parseEntry(raw: string): { policy: string; sealed: string } {
  let entry: z.infer<typeof entrySchema>;
  try {
    const inner = parseJson("A pre-Q4 vault entry's wrapping", raw, z.string());
    entry = parseJson("A pre-Q4 vault entry", inner, entrySchema);
  } catch (error) {
    throw new Error("not a vault entry in the pre-Q4 format", { cause: error });
  }
  return { policy: entry.policy, sealed: entry.sealed };
}

function parseIndex(raw: string): string[] {
  try {
    const inner = parseJson("The pre-Q4 vault index's wrapping", raw, z.string());
    return parseJson("The pre-Q4 vault index", inner, z.array(z.unknown())).filter(
      (id): id is string => typeof id === "string",
    );
  } catch {
    return [];
  }
}

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
  const ids = [...new Set([...index.filter((id) => entries.has(id)), ...entries.keys()])];
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
    if (moved && hasSecretsKey()) {
      try {
        localItemValues(db, id);
      } catch (error) {
        report.unreadable.push({ id, reason: (error as Error).message });
      }
    }
  }
  if (report.failed.length === 0) db.delete(kv).where(eq(kv.key, INDEX_KEY)).run();
  return report;
}

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

export function moveConnectionSecret(seen: Connection): boolean {
  if (!seen.secretEnc) return false;
  const value = openHeaderSecret(seen.id, seen.secretEnc);
  return db.transaction((tx) => {
    const row = tx.select().from(connections).where(eq(connections.id, seen.id)).get();
    if (!row || row.secretEnc !== seen.secretEnc) return false;
    const itemId = writeOwnHeaderSecret(tx, row, value, "vault_import");
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
