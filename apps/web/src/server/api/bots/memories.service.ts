/**
 * Memory CRUD over app.db (issue #22). The page owns every write the capture
 * pipeline doesn't: manual add, edit, delete-as-tombstone, restore. Deleting
 * is a status flip, never a row removal — the tombstone is what stops an
 * exact-text re-capture, so it must survive.
 */
import { Boom } from "@groot/core/errors";
import { prisma } from "@groot/core/database";
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
  const bot = await prisma.bot.findUnique({ where: { id }, select: { id: true } });
  if (!bot) throw Boom.notFound("Bot not found");
  return bot.id;
}

async function findMemory(id: string): Promise<MemoryRow> {
  const row = await prisma.memory.findUnique({ where: { id } });
  if (!row) throw Boom.notFound("Memory not found");
  return row as MemoryRow;
}

/** Flip expired active rows to `expired` so the status column reflects reality (lazy, best-effort). */
async function sweepExpired(botId: string): Promise<void> {
  const now = new Date();
  const expired = await prisma.memory.findMany({
    where: { botId, status: "active", until: { not: null, lte: now } },
    select: { id: true },
  });
  if (expired.length > 0) {
    await prisma.memory.updateMany({
      where: { id: { in: expired.map((m) => m.id) } },
      data: { status: "expired" },
    });
  }
}

export async function list(id: string, includeArchived = false): Promise<MemoryRecord[]> {
  const botId = await findBotId(id);
  await sweepExpired(botId);
  const statuses = includeArchived
    ? ["active", "superseded", "archived", "expired"]
    : ["active", "superseded"];
  const rows = await prisma.memory.findMany({
    where: { botId, status: { in: statuses } },
    orderBy: [{ createdAt: "asc" }],
  });
  return rows.map(toRecord);
}

export async function create(id: string, data: CreateMemoryDTO): Promise<MemoryRecord> {
  const botId = await findBotId(id);
  const row = await prisma.memory.create({
    data: {
      botId,
      text: data.text,
      category: data.category,
      status: "active",
      source: "manual",
      confidence: null,
      until: data.until ? new Date(data.until) : null,
    },
  });
  await enforceBudget(botId);
  return toRecord(row as MemoryRow);
}

export async function update(id: string, data: UpdateMemoryDTO): Promise<MemoryRecord> {
  const row = await findMemory(id);
  const next: Partial<MemoryRow> = {};
  if (data.text !== undefined) next.text = data.text;
  if (data.category !== undefined) next.category = data.category;
  if (data.until !== undefined) next.until = data.until ? new Date(data.until) : null;
  if (data.restore) {
    next.status = "active";
    next.supersededById = null;
    next.supersededAt = null;
  }
  const updated = await prisma.memory.update({ where: { id }, data: next });
  if (data.restore) await enforceBudget(row.botId);
  return toRecord(updated as MemoryRow);
}

export async function remove(id: string): Promise<{ deleted: true }> {
  await findMemory(id);
  await prisma.memory.update({ where: { id }, data: { status: "deleted" } });
  return { deleted: true };
}

/**
 * Budget: at most MEMORY_MAX_ACTIVE active rows. Overflow archives the oldest
 * active rows first — never silent truncation of new facts.
 */
export async function enforceBudget(botId: string): Promise<number> {
  const active = await prisma.memory.findMany({
    where: { botId, status: "active" },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  const overflow = active.slice(0, Math.max(0, active.length - MEMORY_MAX_ACTIVE));
  if (overflow.length > 0) {
    await prisma.memory.updateMany({
      where: { id: { in: overflow.map((m) => m.id) } },
      data: { status: "archived" },
    });
  }
  return active.length - overflow.length;
}

export { isExpired };
