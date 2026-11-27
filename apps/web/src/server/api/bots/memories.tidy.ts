import { and, eq, inArray, max } from "drizzle-orm";
import { z } from "zod";
import { logger } from "@groot/core/logger";
import { registerJobHandler } from "@groot/jobs/server/worker";
import { scheduleJob } from "@groot/jobs/server/queue";
import { app } from "../../app-root";
import { bots, db, memories } from "../../db";
import { memoryCategorySchema, memoryTextSchema } from "./memories.domain";
import { memoryLedger, type MemoryRow } from "./memories.ledger";
import type { SideCaller } from "./side-call";
import { ownerDisplayName } from "../people/people.service";

const MEMORY_TIDY_JOB = "memory-tidy";
const MEMORY_TIDY_CRON = "30 3 * * 0";
const TIDY_MIN_ACTIVE = 10;
const TIDY_TIMEOUT_MS = 60_000;

const tidySchema = z.object({
  merge: z
    .array(
      z.object({
        refs: z.array(z.string()).min(2),
        text: memoryTextSchema,
        category: memoryCategorySchema,
      }),
    )
    .default([]),
  stale: z.array(z.string()).default([]),
});

type TidyPlan = z.infer<typeof tidySchema>;

export function setMemoryTidier(next: { sideCaller: SideCaller } | undefined): void {
  app().memoryTidier = next;
}

function buildTidyPrompt(
  botName: string,
  ownerName: string | undefined,
  rows: readonly MemoryRow[],
  today: string,
): string {
  const lines = rows.map(
    (row, i) =>
      `- m${i + 1} [${row.category}] ${row.text}${row.until ? ` (until ${row.until.toISOString().slice(0, 10)})` : ""}`,
  );
  return [
    `You tidy the long-term memory of an assistant named ${botName}. You have no tools. Today is ${today}.`,
    "",
    "Memories, oldest first:",
    ...lines,
    "",
    "Find only clear problems:",
    `- merge: two or more memories that say the same thing, or where one refines another. Give their refs and one third-person sentence that ${ownerName ? `names ${ownerName} and ` : ""}keeps every detail.`,
    "- stale: a memory a newer one contradicts (the older is stale), or a time-bound fact whose time has clearly passed.",
    "Leave everything else alone. When unsure, leave it. Never invent facts.",
    'Return ONLY JSON: {"merge":[{"refs":["m1","m4"],"text":"...","category":"preference|fact|goal|habit"}],"stale":["m7"]}. Return {"merge":[],"stale":[]} when nothing needs tidying.',
  ].join("\n");
}

function parseTidy(reply: string): TidyPlan | null {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start === -1 || end < start) return null;
  try {
    const result = tidySchema.safeParse(JSON.parse(reply.slice(start, end + 1)));
    return result.success ? result.data : null;
  } catch (error) {
    logger.warn({ error }, "Memory tidy reply is not JSON");
    return null;
  }
}

async function changedSinceTidy(botId: string, tidiedAt: Date | null): Promise<boolean> {
  if (!tidiedAt) return true;
  const [row] = await db
    .select({ latest: max(memories.updatedAt) })
    .from(memories)
    .where(eq(memories.botId, botId));
  const latest = row?.latest;
  return latest !== null && latest !== undefined && new Date(latest) > tidiedAt;
}

async function markTidied(botId: string, at: Date): Promise<void> {
  await db.update(bots).set({ memoryTidiedAt: at }).where(eq(bots.id, botId));
}

async function changedDuringCall(
  botId: string,
  planned: readonly string[],
  revisions: ReadonlyMap<string, number>,
): Promise<boolean> {
  const rows = await db
    .select({ id: memories.id, updatedAt: memories.updatedAt })
    .from(memories)
    .where(eq(memories.botId, botId));
  return rows.some(
    (row) => planned.includes(row.id) && row.updatedAt.getTime() !== revisions.get(row.id),
  );
}

export async function tidyBotMemories(
  botId: string,
  sideCaller: SideCaller,
  now: Date = new Date(),
): Promise<{ merged: number; staled: number } | undefined> {
  const bot = await db.query.bots.findFirst({
    where: eq(bots.id, botId),
    columns: { id: true, name: true, modelId: true, memoryEnabled: true, memoryTidiedAt: true },
  });
  if (!bot?.memoryEnabled) return undefined;
  if (!(await changedSinceTidy(bot.id, bot.memoryTidiedAt))) return undefined;
  const ledger = memoryLedger(bot.id);
  const rows = await ledger.active(now);
  if (rows.length < TIDY_MIN_ACTIVE) {
    await markTidied(bot.id, now);
    return undefined;
  }
  const reply = await sideCaller.complete({
    role: "memory_capture",
    ...(bot.modelId ? { botModelId: bot.modelId } : {}),
    system: buildTidyPrompt(
      bot.name,
      await ownerDisplayName(),
      rows,
      now.toISOString().slice(0, 10),
    ),
    user: "Tidy now.",
    timeoutMs: TIDY_TIMEOUT_MS,
    label: "Memory tidy",
    botId: bot.id,
  });
  if (reply === undefined) return undefined;
  const plan = parseTidy(reply);
  if (!plan) {
    logger.warn({ botId: bot.id }, "Memory tidy output unparseable; next week retries");
    return undefined;
  }
  const idOf = new Map(rows.map((row, i) => [`m${i + 1}`, row.id]));
  const resolve = (refs: readonly string[]) => [
    ...new Set(refs.flatMap((ref) => (idOf.has(ref) ? [idOf.get(ref)!] : []))),
  ];
  const merges = plan.merge
    .map((merge) => ({ ...merge, ids: resolve(merge.refs) }))
    .filter((merge) => merge.ids.length >= 2);
  const merged = new Set(merges.flatMap((merge) => merge.ids));
  const stale = resolve(plan.stale).filter((id) => !merged.has(id));
  const touched = merged.size + stale.length;
  if (touched > rows.length / 2) {
    logger.warn(
      { botId: bot.id, touched, active: rows.length },
      "Memory tidy wanted to change over half the memories; skipped",
    );
    await markTidied(bot.id, new Date());
    return undefined;
  }
  const planned = [...merged, ...stale];
  if (
    planned.length > 0 &&
    (await changedDuringCall(
      bot.id,
      planned,
      new Map(rows.map((row) => [row.id, row.updatedAt.getTime()])),
    ))
  ) {
    logger.warn(
      { botId: bot.id },
      "Memory tidy skipped its plan; a memory changed during the model call",
    );
    return undefined;
  }
  const result = await ledger.consolidate(
    merges.map(({ ids, text, category }) => ({ ids, text, category })),
    stale,
    now,
  );
  await markTidied(bot.id, new Date());
  logger.info({ botId: bot.id, ...result }, "Memory tidy complete");
  return result;
}

export async function tidyAllMemories(now: Date = new Date()): Promise<void> {
  const tidier = app().memoryTidier;
  if (!tidier) return;
  const enabled = await db
    .select({ id: bots.id })
    .from(bots)
    .where(
      and(
        eq(bots.memoryEnabled, true),
        inArray(bots.id, db.select({ id: memories.botId }).from(memories)),
      ),
    );
  for (const bot of enabled) {
    try {
      await tidyBotMemories(bot.id, tidier.sideCaller, now);
    } catch (error) {
      logger.warn({ error, botId: bot.id }, "Memory tidy failed for a bot");
    }
  }
}

export function registerMemoryTidyJob(): void {
  registerJobHandler(MEMORY_TIDY_JOB, async () => {
    await tidyAllMemories();
  });
}

export function scheduleMemoryTidy(): Promise<unknown> {
  return scheduleJob(MEMORY_TIDY_JOB, null, MEMORY_TIDY_CRON, { timezone: "Asia/Kolkata" });
}
