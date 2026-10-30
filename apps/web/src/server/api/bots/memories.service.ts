/**
 * Memory CRUD over app.db (issue #22). The page owns every write the capture
 * pipeline doesn't: manual add, edit, delete-as-tombstone, restore. Deleting
 * is a status flip, never a row removal — the tombstone is what stops an
 * exact-text re-capture, so it must survive.
 */
import { and, asc, eq, inArray, isNotNull, lte } from "drizzle-orm";
import { Boom } from "@groot/core/errors";
import { bots, db, memories } from "../../db";
import {
  isExpired,
  MEMORY_MAX_ACTIVE,
  type MemoryCategory,
  type MemoryRecord,
  type MemoryStatus,
} from "./memories.domain";
import type { CreateMemoryDTO, UpdateMemoryDTO } from "./memories.schema";

type MemoryRow = {
  id: string;
  botId: string;
  text: string;
  category: string;
  status: string;
  source: string;
  confidence: number | null;
  until: Date | null;
  supersededById: string | null;
  supersededAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function toRecord(row: MemoryRow): MemoryRecord {
  return {
    id: row.id,
    botId: row.botId,
    text: row.text,
    category: row.category as MemoryCategory,
    status: row.status as MemoryStatus,
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

/** Flip expired active rows to `expired` so the status column reflects reality (lazy, best-effort). */
async function sweepExpired(botId: string): Promise<void> {
  const now = new Date();
  const expired = await db
    .select({ id: memories.id })
    .from(memories)
    .where(
      and(
        eq(memories.botId, botId),
        eq(memories.status, "active"),
        isNotNull(memories.until),
        lte(memories.until, now),
      ),
    );
  if (expired.length > 0) {
    await db
      .update(memories)
      .set({ status: "expired" })
      .where(
        inArray(
          memories.id,
          expired.map((m) => m.id),
        ),
      );
  }
}

export async function list(id: string, includeArchived = false): Promise<MemoryRecord[]> {
  const botId = await findBotId(id);
  await sweepExpired(botId);
  const statuses = includeArchived
    ? ["active", "superseded", "archived", "expired"]
    : ["active", "superseded"];
  const rows = await db
    .select()
    .from(memories)
    .where(and(eq(memories.botId, botId), inArray(memories.status, statuses)))
    .orderBy(asc(memories.createdAt));
  return rows.map(toRecord);
}

export async function create(id: string, data: CreateMemoryDTO): Promise<MemoryRecord> {
  const botId = await findBotId(id);
  const [row] = await db
    .insert(memories)
    .values({
      botId,
      text: data.text,
      category: data.category,
      status: "active",
      source: "manual",
      confidence: null,
      until: data.until ? new Date(data.until) : null,
    })
    .returning();
  await enforceBudget(botId);
  return toRecord(row!);
}

export async function update(id: string, data: UpdateMemoryDTO): Promise<MemoryRecord> {
  const row = await findMemory(id);
  const next: Partial<MemoryRow> = {};
  if (data.text !== undefined) next.text = data.text;
  if (data.category !== undefined) next.category = data.category;
  if (data.until !== undefined) next.until = data.until ? new Date(data.until) : null;
  if (data.restore && row.status !== "deleted") {
    next.status = "active";
    next.supersededById = null;
    next.supersededAt = null;
  }
  // Nothing to write (e.g. restoring a tombstone): the row as it is, updatedAt untouched.
  const [updated] =
    Object.keys(next).length > 0
      ? await db.update(memories).set(next).where(eq(memories.id, id)).returning()
      : [row];
  if (!updated) throw Boom.notFound("Memory not found");
  if (data.restore) await enforceBudget(row.botId);
  return toRecord(updated);
}

export async function remove(id: string): Promise<{ deleted: true }> {
  await findMemory(id);
  await db.update(memories).set({ status: "deleted" }).where(eq(memories.id, id));
  return { deleted: true };
}

/**
 * Budget: at most MEMORY_MAX_ACTIVE active rows. Overflow archives the oldest
 * active rows first — never silent truncation of new facts.
 */
export async function enforceBudget(botId: string): Promise<number> {
  await sweepExpired(botId);
  const active = await db
    .select({ id: memories.id })
    .from(memories)
    .where(and(eq(memories.botId, botId), eq(memories.status, "active")))
    .orderBy(asc(memories.createdAt));
  const overflow = active.slice(0, Math.max(0, active.length - MEMORY_MAX_ACTIVE));
  if (overflow.length > 0) {
    await db
      .update(memories)
      .set({ status: "archived" })
      .where(
        inArray(
          memories.id,
          overflow.map((m) => m.id),
        ),
      );
  }
  return active.length - overflow.length;
}

export { isExpired };
