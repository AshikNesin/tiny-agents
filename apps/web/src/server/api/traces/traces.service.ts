import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
import { Boom } from "@groot/core/errors";
import { logger } from "@groot/core/logger";
import { db, botMessages, llmCalls, routineRuns } from "../../db";
import { getAgentRuntime } from "../bots/bots.runtime";
import { listLlmCalls } from "./traces.calls";
import type {
  SideCallList,
  TraceSession,
  TraceSessionDetail,
  TraceSessionFilter,
  TraceSessionKind,
  TraceSessionList,
  TraceSummary,
} from "../../../shared/api/traces";

const TRACE_PAGE = 30;
const SUMMARY_DAYS = 7;

type SessionRow = Omit<TraceSession, "usage" | "harness"> & { botModelId: string | null };

const ms = (date: Date | null | undefined) => (date ? date.getTime() : 0);

async function sessionRows(filter?: TraceSessionFilter): Promise<SessionRow[]> {
  const rows: SessionRow[] = [];
  const want = (k: TraceSessionKind) =>
    !filter || filter === k || (filter === "chats" && (k === "chat" || k === "past_chat"));
  const botList =
    want("chat") || want("past_chat")
      ? await db.query.bots.findMany({
          columns: {
            id: true,
            name: true,
            modelId: true,
            conversationId: true,
            chatStartedAt: true,
            lastActivityAt: true,
          },
        })
      : [];
  if (want("chat")) {
    for (const bot of botList) {
      rows.push({
        id: bot.conversationId,
        kind: "chat",
        title: bot.name,
        bot: { id: bot.id, name: bot.name },
        botModelId: bot.modelId,
        startedAt: ms(bot.chatStartedAt),
        lastAt: ms(bot.lastActivityAt),
      });
    }
  }
  if (want("past_chat")) {
    const chats = await db.query.botChats.findMany({
      with: { bot: { columns: { id: true, name: true, modelId: true } } },
    });
    for (const chat of chats) {
      rows.push({
        id: chat.conversationId,
        kind: "past_chat",
        title: chat.title || "Past chat",
        bot: { id: chat.bot.id, name: chat.bot.name },
        chatId: chat.id,
        botModelId: chat.bot.modelId,
        startedAt: ms(chat.startedAt),
        lastAt: ms(chat.endedAt),
      });
    }
  }
  if (want("routine")) {
    const runs = await db.query.routineRuns.findMany({
      where: isNotNull(routineRuns.conversationId),
      with: {
        routine: {
          columns: { name: true },
          with: { bot: { columns: { id: true, name: true, modelId: true } } },
        },
      },
    });
    for (const run of runs) {
      const startedAt = ms(run.startedAt ?? run.submittedAt ?? run.scheduledFor);
      rows.push({
        id: run.conversationId!,
        kind: "routine",
        title: run.routine.name,
        bot: { id: run.routine.bot.id, name: run.routine.bot.name },
        botModelId: run.routine.bot.modelId,
        startedAt,
        lastAt: ms(run.finishedAt) || startedAt,
      });
    }
  }
  if (want("delivery")) {
    const deliveries = await db.query.botMessages.findMany({
      where: and(eq(botMessages.ownConversation, true), isNotNull(botMessages.conversationId)),
      with: {
        bot: { columns: { name: true } },
        to: { columns: { id: true, name: true, modelId: true } },
      },
    });
    for (const delivery of deliveries) {
      rows.push({
        id: delivery.conversationId!,
        kind: "delivery",
        title: delivery.bot ? `Message from ${delivery.bot.name}` : "Message from a bot",
        bot: { id: delivery.to.id, name: delivery.to.name },
        botModelId: delivery.to.modelId,
        startedAt: ms(delivery.createdAt),
        lastAt: ms(delivery.answeredAt ?? delivery.deliveredAt ?? delivery.createdAt),
      });
    }
  }
  return rows.sort((a, b) => b.lastAt - a.lastAt);
}

function usageUnknown(error: unknown): null {
  logger.warn({ error }, "Traces: could not read a session's usage");
  return null;
}

async function withUsage(row: SessionRow): Promise<TraceSession> {
  const runtime = getAgentRuntime();
  const { botModelId, ...session } = row;
  const modelId = botModelId ?? runtime.catalog.forRole("bot_default")?.id;
  const engine = modelId ? runtime.catalog.route(modelId)?.engine : undefined;
  const usage = await runtime.usage(Number(row.id)).catch(usageUnknown);
  return { ...session, harness: engine === "claude-code" ? "claude-plan" : "pi", usage };
}

export async function listSessions(options: {
  kind?: TraceSessionFilter;
  before?: number;
}): Promise<TraceSessionList> {
  const rows = (await sessionRows(options.kind)).filter(
    (row) => options.before === undefined || row.lastAt < options.before,
  );
  const page = rows.slice(0, TRACE_PAGE);
  const sessions = await Promise.all(page.map(withUsage));
  return {
    sessions,
    next: rows.length > TRACE_PAGE ? (page.at(-1)?.lastAt ?? null) : null,
  };
}

export async function getSession(conversationId: string): Promise<TraceSessionDetail> {
  const row = (await sessionRows()).find((session) => session.id === conversationId);
  if (!row) throw Boom.notFound("No such session");
  const trace = await getAgentRuntime()
    .trace(Number(conversationId))
    .catch((error: unknown) => {
      logger.warn({ error, conversationId }, "Traces: could not load a session's trace");
      throw Boom.notFound("This session is no longer stored");
    });
  return { session: await withUsage(row), trace };
}

export async function listSideCalls(options: { before?: number }): Promise<SideCallList> {
  const rows = await listLlmCalls({
    ...(options.before !== undefined ? { before: options.before } : {}),
    limit: TRACE_PAGE + 1,
  });
  const page = rows.slice(0, TRACE_PAGE);
  return {
    calls: page.map((row) => ({
      id: row.id,
      purpose: row.purpose,
      bot: row.bot ? { id: row.bot.id, name: row.bot.name } : null,
      provider: row.provider,
      model: row.model,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      cacheReadTokens: row.cacheReadTokens,
      cacheWriteTokens: row.cacheWriteTokens,
      costUsd: row.costUsd,
      durationMs: row.durationMs,
      outcome: row.outcome,
      error: row.error,
      createdAt: ms(row.createdAt),
    })),
    next: rows.length > TRACE_PAGE ? ms(page.at(-1)?.createdAt) : null,
  };
}

export async function summary(): Promise<TraceSummary> {
  const since = Date.now() - SUMMARY_DAYS * 24 * 60 * 60 * 1000;
  const active = (await sessionRows()).filter((row) => row.lastAt >= since);
  const runtime = getAgentRuntime();
  const usages = await Promise.all(
    active.map((row) => runtime.usage(Number(row.id)).catch(usageUnknown)),
  );
  let costUsd = 0;
  let tokens = 0;
  for (const usage of usages) {
    if (!usage) continue;
    costUsd += usage.costUsd;
    tokens += usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
  }
  const [side] = await db
    .select({
      count: sql<number>`count(*)`,
      cost: sql<number>`coalesce(sum(${llmCalls.costUsd}), 0)`,
      tokens: sql<number>`coalesce(sum(${llmCalls.inputTokens} + ${llmCalls.outputTokens} + ${llmCalls.cacheReadTokens} + ${llmCalls.cacheWriteTokens}), 0)`,
    })
    .from(llmCalls)
    .where(gte(llmCalls.createdAt, new Date(since)));
  return {
    since,
    sessions: active.length,
    costUsd: costUsd + Number(side?.cost ?? 0),
    tokens: tokens + Number(side?.tokens ?? 0),
    sideCalls: Number(side?.count ?? 0),
  };
}
