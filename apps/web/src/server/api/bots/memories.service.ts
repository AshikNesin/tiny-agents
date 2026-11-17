/**
 * The Memory page's API over the memory ledger (issue #22): list, add,
 * edit, delete-as-tombstone, restore. Every rule (dedupe, tombstones,
 * expiry, the budget) is the ledger's (memories.ledger.ts); this module
 * finds the bot or the row and shapes records for the page.
 */
import { eq } from "drizzle-orm";
import { Boom } from "@groot/core/errors";
import { bots, db, memories } from "../../db";
import { type MemoryCategory, type MemoryRecord } from "./memories.domain";
import type { MemoryStatus } from "../../../shared/machines/memory";
import { memoryLedger, type MemoryRow } from "./memories.ledger";
import type { CreateMemoryDTO, UpdateMemoryDTO } from "./memories.schema";

function toRecord(row: MemoryRow): MemoryRecord {
  return {
    id: row.id,
    botId: row.botId,
    text: row.text,
    category: row.category as MemoryCategory,
    status: row.status,
    source: row.source === "manual" ? "manual" : "capture",
    confidence: row.confidence,
    until: row.until?.toISOString() ?? null,
    supersededById: row.supersededById,
    supersededAt: row.supersededAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function findBotId(id: string): Promise<string> {
  const bot = await db.query.bots.findFirst({ where: eq(bots.id, id), columns: { id: true } });
  if (!bot) throw Boom.notFound("Bot not found");
  return bot.id;
}

async function findMemory(id: string): Promise<MemoryRow> {
  const row = await db.query.memories.findFirst({ where: eq(memories.id, id) });
  if (!row) throw Boom.notFound("Memory not found");
  return row;
}

export async function list(id: string, includeArchived = false): Promise<MemoryRecord[]> {
  const botId = await findBotId(id);
  const statuses: MemoryStatus[] = includeArchived
    ? ["active", "superseded", "archived", "expired"]
    : ["active", "superseded"];
  return (await memoryLedger(botId).history(statuses)).map(toRecord);
}

/**
 * The owner adds a memory. Text the bot already has active returns that
 * memory; text of a removed, archived or replaced one brings it back as new.
 */
export async function create(id: string, data: CreateMemoryDTO): Promise<MemoryRecord> {
  const botId = await findBotId(id);
  const { rows } = await memoryLedger(botId).add(
    [{ text: data.text, category: data.category, until: data.until ?? null }],
    { source: "manual" },
  );
  return toRecord(rows[0]!);
}

export async function update(id: string, data: UpdateMemoryDTO): Promise<MemoryRecord> {
  const row = await findMemory(id);
  const ledger = memoryLedger(row.botId);
  const { restore, ...change } = data;
  let updated = await ledger.edit(id, change);
  if (!updated) throw Boom.notFound("Memory not found");
  if (restore) updated = (await ledger.restore(updated.id)) ?? updated;
  return toRecord(updated);
}

export async function remove(id: string): Promise<{ deleted: true }> {
  const row = await findMemory(id);
  await memoryLedger(row.botId).tombstone([id]);
  return { deleted: true };
}
