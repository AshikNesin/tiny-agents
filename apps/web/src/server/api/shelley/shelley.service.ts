/**
 * What tiny-agents keeps about Shelley (issue #143): which conversations the
 * owner follows here (unread markers, finish pushes) and which ones bots
 * handed off (finish delivered to the bot once). Shelley's own database stays
 * the source of truth for everything else.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { logger } from "@groot/core/logger";
import { db, shelleyHandoffs, shelleySeen, type ShelleyHandoff } from "../../db";
import { shelleyJson, type ShelleyConfig, type FetchLike } from "./shelley.client";

// --- followed conversations (unread) -----------------------------------------

/** Follow a conversation (started, opened or handed off here); keeps an existing mark. */
export async function follow(conversationId: string): Promise<void> {
  await db.insert(shelleySeen).values({ conversationId }).onConflictDoNothing();
}

/** The owner has seen `conversationId` up to `sequenceId` (never moves backwards). */
export async function markSeen(conversationId: string, sequenceId: number): Promise<void> {
  const [row] = await db
    .select({ last: shelleySeen.lastSeenSequenceId })
    .from(shelleySeen)
    .where(eq(shelleySeen.conversationId, conversationId));
  if (row && row.last >= sequenceId) return;
  await db
    .insert(shelleySeen)
    .values({ conversationId, lastSeenSequenceId: sequenceId, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: shelleySeen.conversationId,
      set: { lastSeenSequenceId: sequenceId, updatedAt: new Date() },
    });
}

/** Followed conversations and how far the owner has read each. */
export async function seenMap(): Promise<Map<string, number>> {
  const rows = await db.select().from(shelleySeen);
  return new Map(rows.map((r) => [r.conversationId, r.lastSeenSequenceId]));
}

export async function isFollowed(conversationId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: shelleySeen.conversationId })
    .from(shelleySeen)
    .where(eq(shelleySeen.conversationId, conversationId));
  return Boolean(row);
}

// --- hand-offs ---------------------------------------------------------------

export interface HandoffInput {
  botId: string;
  idempotencyKey: string;
  task: string;
  cwd?: string;
}

export async function findHandoffByKey(key: string): Promise<ShelleyHandoff | undefined> {
  return db.query.shelleyHandoffs.findFirst({ where: eq(shelleyHandoffs.idempotencyKey, key) });
}

export async function recordHandoff(
  input: HandoffInput & { shelleyConversationId: string; slug?: string | null },
): Promise<ShelleyHandoff> {
  await db
    .insert(shelleyHandoffs)
    .values({
      botId: input.botId,
      idempotencyKey: input.idempotencyKey,
      task: input.task,
      cwd: input.cwd ?? null,
      shelleyConversationId: input.shelleyConversationId,
      slug: input.slug ?? null,
      status: "running",
    })
    .onConflictDoNothing();
  await follow(input.shelleyConversationId);
  const row = await findHandoffByKey(input.idempotencyKey);
  if (!row) throw new Error("hand-off row missing after insert");
  return row;
}

export async function listHandoffs(botId: string, limit = 20): Promise<ShelleyHandoff[]> {
  return db
    .select()
    .from(shelleyHandoffs)
    .where(eq(shelleyHandoffs.botId, botId))
    .orderBy(desc(shelleyHandoffs.createdAt))
    .limit(limit);
}

export async function findHandoff(
  botId: string,
  shelleyConversationId: string,
): Promise<ShelleyHandoff | undefined> {
  return db.query.shelleyHandoffs.findFirst({
    where: and(
      eq(shelleyHandoffs.botId, botId),
      eq(shelleyHandoffs.shelleyConversationId, shelleyConversationId),
    ),
    orderBy: desc(shelleyHandoffs.createdAt),
  });
}

/** Mark a hand-off running again (the bot sent a follow-up), so its next finish is delivered. */
export async function reopenHandoff(id: string): Promise<void> {
  await db
    .update(shelleyHandoffs)
    .set({ status: "running", finishedAt: null })
    .where(eq(shelleyHandoffs.id, id));
}

/** Running hand-offs of these conversations (all when omitted). */
export async function runningHandoffs(conversationIds?: string[]): Promise<ShelleyHandoff[]> {
  const running = eq(shelleyHandoffs.status, "running");
  return db
    .select()
    .from(shelleyHandoffs)
    .where(
      conversationIds
        ? and(running, inArray(shelleyHandoffs.shelleyConversationId, conversationIds))
        : running,
    );
}

/** running → finished, once: true for the caller that won. */
export async function finishHandoffOnce(id: string): Promise<boolean> {
  const updated = await db
    .update(shelleyHandoffs)
    .set({ status: "finished", finishedAt: new Date() })
    .where(and(eq(shelleyHandoffs.id, id), eq(shelleyHandoffs.status, "running")))
    .returning({ id: shelleyHandoffs.id });
  return updated.length > 0;
}

// --- reading a turn's outcome from Shelley -----------------------------------

interface ShelleyMessageRow {
  sequence_id: number;
  type: string;
  llm_data?: string | null;
  created_at: string;
  end_of_turn?: boolean | null;
}

export interface TurnOutcome {
  working: boolean;
  slug: string | null;
  /** Text of the last agent message, or the last error. */
  text: string;
  failed: boolean;
  /** When the last agent/error message was written (ms). */
  endedAt?: number;
  maxSequenceId: number;
}

function textOf(llmData: string | null | undefined): string {
  if (!llmData) return "";
  try {
    const parsed = JSON.parse(llmData) as { Content?: Array<{ Type?: number; Text?: string }> };
    return (parsed.Content ?? [])
      .filter((c) => c.Type === 2 && c.Text)
      .map((c) => c.Text)
      .join("\n")
      .trim();
  } catch {
    return "";
  }
}

/** How a conversation stands now: idle or working, and its last answer. */
export async function readTurnOutcome(
  conversationId: string,
  options?: { config?: ShelleyConfig; fetch?: FetchLike },
): Promise<TurnOutcome> {
  const data = await shelleyJson<{
    messages?: ShelleyMessageRow[];
    conversation?: { agent_working?: boolean; slug?: string | null };
  }>(`/conversation/${encodeURIComponent(conversationId)}`, {}, options);
  const messages = data.messages ?? [];
  let text = "";
  let failed = false;
  let endedAt: number | undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.type !== "agent" && m.type !== "error") continue;
    const body = textOf(m.llm_data);
    if (!body && m.type === "agent") continue;
    text = body;
    failed = m.type === "error";
    endedAt = Date.parse(m.created_at);
    break;
  }
  return {
    working: Boolean(data.conversation?.agent_working),
    slug: data.conversation?.slug ?? null,
    text,
    failed,
    endedAt,
    maxSequenceId: messages.reduce((max, m) => Math.max(max, m.sequence_id), 0),
  };
}

/** Trim to a chat-sized excerpt. */
export function excerpt(text: string, max = 1500): string {
  const clean = text.trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export function logWatcherError(error: unknown, conversationId: string, what: string): void {
  logger.warn({ error, conversationId }, `Shelley watcher: ${what} failed`);
}
