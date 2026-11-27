import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, like, lte, or } from "drizzle-orm";
import { Boom } from "@groot/core/errors";
import { bots, db, memories, type AppDatabase } from "../../db";
import {
  MEMORY_MAX_ACTIVE,
  MEMORY_REMOVED_IN_PROMPT,
  type MemoryCategory,
  type MemorySource,
} from "./memories.domain";
import { memoryMachine, type MemoryStatus } from "../../../shared/machines/memory";

export type MemoryRow = typeof memories.$inferSelect;

interface LedgerItem {
  text: string;
  category: MemoryCategory;
  until?: string | null;
  supersedesIds?: string[] | null;
}

interface AddOptions {
  source: MemorySource;
  watermark?: Date;
  conversationId?: string;
}

interface AddResult {
  created: number;
  revived: number;
  superseded: number;
  skipped: number;
  rows: MemoryRow[];
}

interface PromptContext {
  current: string | null;
  removed: string | null;
  refs: Record<string, string>;
}

interface LedgerEdit {
  text?: string;
  category?: MemoryCategory;
  until?: string | null;
}

export interface MemoryLedger {
  add(items: readonly LedgerItem[], options: AddOptions): Promise<AddResult>;
  edit(id: string, change: LedgerEdit): Promise<MemoryRow | undefined>;
  tombstone(ids: readonly string[]): Promise<number>;
  restore(id: string): Promise<MemoryRow | undefined>;
  active(now?: Date): Promise<MemoryRow[]>;
  history(statuses: readonly MemoryStatus[], now?: Date): Promise<MemoryRow[]>;
  promptContext(now?: Date): Promise<PromptContext>;
  advanceWatermark(at: Date): Promise<void>;
  nameOwner(name: string): Promise<void>;
  consolidate(
    merges: readonly ConsolidateMerge[],
    stale: readonly string[],
    now?: Date,
  ): Promise<{ merged: number; staled: number }>;
}

interface ConsolidateMerge {
  ids: readonly string[];
  text: string;
  category: MemoryCategory;
}

type Tx = Pick<AppDatabase, "select" | "insert" | "update">;

const key = (text: string) =>
  text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[\s.!?;:,]+$/u, "");

const notExpired = (now: Date) => or(isNull(memories.until), gt(memories.until, now));

export function memoryLedger(botId: string): MemoryLedger {
  const ofBot = eq(memories.botId, botId);

  function expire(tx: Tx, now: Date): void {
    tx.update(memories)
      .set({ status: "expired" })
      .where(
        and(
          ofBot,
          inArray(memories.status, memoryMachine.sourcesOf("expired")),
          isNotNull(memories.until),
          lte(memories.until, now),
        ),
      )
      .run();
  }

  function enforceBudget(tx: Tx, keep?: string): void {
    const active = tx
      .select({ id: memories.id })
      .from(memories)
      .where(and(ofBot, eq(memories.status, "active")))
      .orderBy(asc(memories.createdAt))
      .all();
    const overflow = active
      .filter((row) => row.id !== keep)
      .slice(0, Math.max(0, active.length - MEMORY_MAX_ACTIVE))
      .map((row) => row.id);
    if (overflow.length === 0) return;
    tx.update(memories).set({ status: "archived" }).where(inArray(memories.id, overflow)).run();
  }

  function setWatermark(tx: Pick<AppDatabase, "update">, at: Date): void {
    const { changes } = tx
      .update(bots)
      .set({ memoryCapturedThrough: at })
      .where(eq(bots.id, botId))
      .run();
    if (changes === 0) throw Boom.notFound("Bot not found");
  }

  async function add(items: readonly LedgerItem[], options: AddOptions): Promise<AddResult> {
    const result: AddResult = {
      created: 0,
      revived: 0,
      superseded: 0,
      skipped: 0,
      rows: [],
    };
    return db.transaction((tx) => {
      const now = new Date();
      expire(tx, now);
      const existing = tx.select().from(memories).where(ofBot).all();
      const byText = new Map(existing.map((row) => [key(row.text), row] as const));
      const activeIds = new Set(existing.filter((row) => row.status === "active").map((r) => r.id));
      for (const item of items) {
        const text = item.text.trim();
        const fields = {
          text,
          category: item.category,
          until: item.until ? new Date(item.until) : null,
          source: options.source,
          conversationId: options.conversationId ?? null,
        };
        const match = byText.get(key(text));
        if (match && (activeIds.has(match.id) || options.source !== "manual")) {
          result.skipped += 1;
          result.rows.push(match);
          continue;
        }
        const row = match
          ? tx
              .update(memories)
              .set({
                ...fields,
                status: "active",
                supersededById: null,
                supersededAt: null,
                createdAt: now,
              })
              .where(eq(memories.id, match.id))
              .returning()
              .get()
          : tx
              .insert(memories)
              .values({ botId, ...fields, status: "active" })
              .returning()
              .get();
        if (match) result.revived += 1;
        else result.created += 1;
        byText.set(key(text), row);
        activeIds.add(row.id);
        result.rows.push(row);
        const replaced = (item.supersedesIds ?? []).filter(
          (id) => id !== row.id && activeIds.has(id),
        );
        if (replaced.length === 0) continue;
        tx.update(memories)
          .set({
            status: "superseded",
            supersededById: row.id,
            supersededAt: now,
          })
          .where(inArray(memories.id, replaced))
          .run();
        for (const id of replaced) activeIds.delete(id);
        result.superseded += replaced.length;
      }
      enforceBudget(tx);
      if (options.watermark) setWatermark(tx, options.watermark);
      return result;
    });
  }

  async function edit(id: string, change: LedgerEdit): Promise<MemoryRow | undefined> {
    return db.transaction((tx) => {
      const row = tx
        .select()
        .from(memories)
        .where(and(ofBot, eq(memories.id, id)))
        .get();
      if (!row) return undefined;
      const fields: Partial<MemoryRow> = {};
      if (change.text !== undefined) fields.text = change.text.trim();
      if (change.category !== undefined) fields.category = change.category;
      if (change.until !== undefined) fields.until = change.until ? new Date(change.until) : null;
      if (Object.keys(fields).length === 0) return row;
      const match =
        fields.text !== undefined && key(fields.text) !== key(row.text)
          ? tx
              .select()
              .from(memories)
              .where(ofBot)
              .all()
              .find((other) => other.id !== id && key(other.text) === key(fields.text!))
          : undefined;
      if (!match) {
        return tx.update(memories).set(fields).where(eq(memories.id, id)).returning().get();
      }
      const now = new Date();
      const landed = tx
        .update(memories)
        .set({ ...fields, status: "active", supersededById: null, supersededAt: null })
        .where(eq(memories.id, match.id))
        .returning()
        .get();
      if (row.status === "active") {
        tx.update(memories)
          .set({ status: "superseded", supersededById: match.id, supersededAt: now })
          .where(eq(memories.id, id))
          .run();
      }
      expire(tx, now);
      enforceBudget(tx, match.id);
      return tx.select().from(memories).where(eq(memories.id, landed.id)).get() ?? landed;
    });
  }

  async function tombstone(ids: readonly string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const { changes } = db
      .update(memories)
      .set({ status: "deleted" })
      .where(
        and(
          ofBot,
          inArray(memories.id, [...ids]),
          inArray(memories.status, memoryMachine.sourcesOf("deleted")),
        ),
      )
      .run();
    return changes;
  }

  async function restore(id: string): Promise<MemoryRow | undefined> {
    return db.transaction((tx) => {
      const row = tx
        .select()
        .from(memories)
        .where(and(ofBot, eq(memories.id, id)))
        .get();
      if (!row) return undefined;
      if (row.status === "deleted") return row;
      tx.update(memories)
        .set({ status: "active", supersededById: null, supersededAt: null })
        .where(eq(memories.id, id))
        .run();
      expire(tx, new Date());
      enforceBudget(tx, id);
      return tx.select().from(memories).where(eq(memories.id, id)).get();
    });
  }

  async function active(now = new Date()): Promise<MemoryRow[]> {
    return db
      .select()
      .from(memories)
      .where(and(ofBot, eq(memories.status, "active"), notExpired(now)))
      .orderBy(asc(memories.createdAt))
      .all();
  }

  async function history(
    statuses: readonly MemoryStatus[],
    now = new Date(),
  ): Promise<MemoryRow[]> {
    expire(db, now);
    return db
      .select()
      .from(memories)
      .where(and(ofBot, inArray(memories.status, [...statuses])))
      .orderBy(asc(memories.createdAt))
      .all();
  }

  async function promptContext(now = new Date()): Promise<PromptContext> {
    const rows = await active(now);
    const refs = Object.fromEntries(rows.map((m, i) => [`m${i + 1}`, m.id]));
    const current = rows
      .map(
        (m, i) =>
          `- m${i + 1} — ${m.text}${m.until ? ` (until ${m.until.toISOString().slice(0, 10)})` : ""}`,
      )
      .join("\n");
    const removed = db
      .select({ text: memories.text })
      .from(memories)
      .where(and(ofBot, eq(memories.status, "deleted")))
      .orderBy(desc(memories.updatedAt))
      .limit(MEMORY_REMOVED_IN_PROMPT)
      .all()
      .map((m) => `- ${m.text}`)
      .join("\n");
    return { current: current || null, removed: removed || null, refs };
  }

  async function advanceWatermark(at: Date): Promise<void> {
    setWatermark(db, at);
  }

  async function nameOwner(name: string): Promise<void> {
    const rows = await db
      .select({ id: memories.id, text: memories.text })
      .from(memories)
      .where(and(eq(memories.botId, botId), like(memories.text, "%the owner%")));
    for (const row of rows) {
      const text = row.text.replace(/\bthe owner\b/gi, name);
      if (text !== row.text) {
        await db
          .update(memories)
          .set({ text, updatedAt: new Date() })
          .where(eq(memories.id, row.id));
      }
    }
  }

  async function consolidate(
    merges: readonly ConsolidateMerge[],
    stale: readonly string[],
    now = new Date(),
  ): Promise<{ merged: number; staled: number }> {
    return db.transaction((tx) => {
      expire(tx, now);
      const existing = tx.select().from(memories).where(ofBot).all();
      const activeIds = new Set(existing.filter((row) => row.status === "active").map((r) => r.id));
      const byText = new Map(existing.map((row) => [key(row.text), row] as const));
      let merged = 0;
      for (const merge of merges) {
        const ids = merge.ids.filter((id) => activeIds.has(id));
        if (ids.length < 2) continue;
        const text = merge.text.trim();
        const match = byText.get(key(text));
        if (match?.status === "deleted") continue;
        const target =
          match && (activeIds.has(match.id) || ids.includes(match.id))
            ? tx
                .update(memories)
                .set({ text, category: merge.category })
                .where(eq(memories.id, match.id))
                .returning()
                .get()
            : match
              ? tx
                  .update(memories)
                  .set({
                    text,
                    category: merge.category,
                    status: "active",
                    supersededById: null,
                    supersededAt: null,
                    createdAt: now,
                  })
                  .where(eq(memories.id, match.id))
                  .returning()
                  .get()
              : tx
                  .insert(memories)
                  .values({
                    botId,
                    text,
                    category: merge.category,
                    source: "capture",
                    status: "active",
                  })
                  .returning()
                  .get();
        activeIds.add(target.id);
        byText.set(key(text), target);
        const replaced = ids.filter((id) => id !== target.id);
        tx.update(memories)
          .set({ status: "superseded", supersededById: target.id, supersededAt: now })
          .where(inArray(memories.id, replaced))
          .run();
        for (const id of replaced) activeIds.delete(id);
        merged += replaced.length;
      }
      const staleIds = stale.filter((id) => activeIds.has(id));
      if (staleIds.length > 0) {
        tx.update(memories)
          .set({ status: "expired", until: now })
          .where(inArray(memories.id, staleIds))
          .run();
      }
      enforceBudget(tx);
      return { merged, staled: staleIds.length };
    });
  }

  return {
    add,
    edit,
    tombstone,
    restore,
    active,
    history,
    promptContext,
    advanceWatermark,
    nameOwner,
    consolidate,
  };
}
