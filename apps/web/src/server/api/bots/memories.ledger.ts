/**
 * The memory ledger (GLOSSARY: Memory ledger): one bot's memories and the
 * rules every write follows, whichever way a memory arrives (capture, the
 * `remember` tool, the Memory page):
 *
 * - Dedupe: an item whose text (trimmed, case-insensitive) matches one of
 *   the bot's rows, in any status, is never a second row. A tombstone (a
 *   memory the owner deleted) is never re-added by capture or chat; only the
 *   owner adding it on the Memory page brings a non-active row back.
 * - Supersede: an item may replace active memories of the same bot, never
 *   another bot's, nor a tombstone.
 * - Expiry: an active row past its `until` becomes `expired`; it never
 *   counts toward the budget and never reaches a prompt.
 * - Budget: at most MEMORY_MAX_ACTIVE active rows; overflow archives the
 *   oldest first, never the new fact. A row the owner just restored is kept.
 * - The capture watermark: advanced with the rows a capture adds, in the
 *   same transaction, so a failed write retries the window.
 *
 * Writes are one synchronous better-sqlite3 transaction each: all or nothing.
 */
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lte, ne, or } from "drizzle-orm";
import { Boom } from "@groot/core/errors";
import { bots, db, memories, type AppDatabase } from "../../db";
import {
  MEMORY_MAX_ACTIVE,
  MEMORY_REMOVED_IN_PROMPT,
  type MemoryCategory,
  type MemorySource,
} from "./memories.domain";

export type MemoryRow = typeof memories.$inferSelect;

/** One memory to add: a capture's extraction item, a chat `remember`, a page add. */
export interface LedgerItem {
  text: string;
  category: MemoryCategory;
  /** ISO date or datetime; null or absent = no expiry. */
  until?: string | null;
  /** Extraction confidence; null for the owner's own entries. */
  confidence?: number | null;
  /** Active memories of this bot the item replaces. */
  supersedesIds?: string[] | null;
}

export interface AddOptions {
  /**
   * `capture` (the capture side-call and the chat `remember` tool) or
   * `manual` (the owner on the Memory page, who may bring back a row).
   */
  source: MemorySource;
  /** A capture's window end: the watermark advances in the same transaction. */
  watermark?: Date;
}

export interface AddResult {
  created: number;
  /** Non-active rows the owner added again (manual adds only). */
  revived: number;
  superseded: number;
  /** Items that matched a row and changed nothing. */
  skipped: number;
  /** For each item, in order, the row it landed on (new, revived or the existing match). */
  rows: MemoryRow[];
}

/** What the capture prompt lists: current memories with ids, and what the owner removed. */
export interface PromptContext {
  current: string | null;
  removed: string | null;
}

export interface MemoryLedger {
  add(items: readonly LedgerItem[], options: AddOptions): Promise<AddResult>;
  /** Tombstone rows of this bot (the owner removed them). Returns how many changed. */
  tombstone(ids: readonly string[]): Promise<number>;
  /**
   * Bring a superseded, archived or expired row back to active, kept even
   * when the budget is full. A tombstone stays one. Undefined when the row
   * is not this bot's.
   */
  restore(id: string): Promise<MemoryRow | undefined>;
  /** Active rows that have not expired, oldest first: what a prompt may carry. */
  active(now?: Date): Promise<MemoryRow[]>;
  /** The page's view: expire what is due, then the rows in these statuses, oldest first. */
  history(statuses: readonly string[], now?: Date): Promise<MemoryRow[]>;
  promptContext(now?: Date): Promise<PromptContext>;
  /** Move the capture watermark (a window with nothing worth a call). Throws for a missing bot. */
  advanceWatermark(at: Date): Promise<void>;
}

type Tx = Pick<AppDatabase, "select" | "insert" | "update">;

const key = (text: string) => text.trim().toLowerCase();

const notExpired = (now: Date) => or(isNull(memories.until), gt(memories.until, now));

export function memoryLedger(botId: string): MemoryLedger {
  const ofBot = eq(memories.botId, botId);

  function expire(tx: Tx, now: Date): void {
    tx.update(memories)
      .set({ status: "expired" })
      .where(
        and(
          ofBot,
          eq(memories.status, "active"),
          isNotNull(memories.until),
          lte(memories.until, now),
        ),
      )
      .run();
  }

  /** Archive the oldest active rows past the budget; `keep` is never archived. */
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
    const result: AddResult = { created: 0, revived: 0, superseded: 0, skipped: 0, rows: [] };
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
          confidence: item.confidence ?? null,
          source: options.source,
        };
        const match = byText.get(key(text));
        if (match && (activeIds.has(match.id) || options.source !== "manual")) {
          result.skipped += 1;
          result.rows.push(match);
          continue;
        }
        const row = match
          ? // The owner adds a memory again: its old row (even a tombstone)
            // comes back as a new memory, never as a second row.
            tx
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
          .set({ status: "superseded", supersededById: row.id, supersededAt: now })
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

  async function tombstone(ids: readonly string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const { changes } = db
      .update(memories)
      .set({ status: "deleted" })
      .where(and(ofBot, inArray(memories.id, [...ids]), ne(memories.status, "deleted")))
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
      // A restore past its expiry is expired again: the owner clears `until` to keep it.
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

  async function history(statuses: readonly string[], now = new Date()): Promise<MemoryRow[]> {
    expire(db, now);
    return db
      .select()
      .from(memories)
      .where(and(ofBot, inArray(memories.status, [...statuses])))
      .orderBy(asc(memories.createdAt))
      .all();
  }

  async function promptContext(now = new Date()): Promise<PromptContext> {
    const current = (await active(now))
      .map(
        (m) =>
          `- ${m.id} — ${m.text}${m.until ? ` (until ${m.until.toISOString().slice(0, 10)})` : ""}`,
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
    return { current: current || null, removed: removed || null };
  }

  async function advanceWatermark(at: Date): Promise<void> {
    setWatermark(db, at);
  }

  return { add, tombstone, restore, active, history, promptContext, advanceWatermark };
}
