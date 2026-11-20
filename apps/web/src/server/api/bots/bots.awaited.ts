import { logger } from "@groot/core/logger";
import { finishedReplyTo, type AgentRuntime, type FinishedReply } from "@tiny-agents/agent";
import type { ChatRead } from "./bots.settled";

export interface AwaitedRow {
  requestId: string;
  conversationId: number;
}

export interface AwaitedAdapter<Row extends AwaitedRow> {
  name: string;
  pending(conversationId?: number): Promise<Row[]>;
  answered(row: Row, reply: FinishedReply): Promise<void>;
  interrupted(row: Row): Promise<void>;
}

export interface AwaitedSubmissions {
  answer(conversationId: number, chat?: ChatRead): Promise<number>;
  sweep(): Promise<number>;
}

export function awaitedSubmissions<Row extends AwaitedRow>(
  rt: Pick<AgentRuntime, "readChat" | "isBusy">,
  adapter: AwaitedAdapter<Row>,
): AwaitedSubmissions {
  async function settleRows(
    rows: Row[],
    chat: ChatRead,
    unanswered: ((row: Row) => Promise<void>) | undefined,
  ): Promise<number> {
    if (rows.length === 0) return 0;
    const state = await chat();
    let settled = 0;
    for (const row of rows) {
      try {
        const outcome = finishedReplyTo(state, row.requestId);
        if (outcome.status === "answered") await adapter.answered(row, outcome.reply);
        else if (unanswered) await unanswered(row);
        else continue;
        settled += 1;
      } catch (error) {
        logger.warn(
          { error, requestId: row.requestId, kind: adapter.name },
          "Settling an awaited submission failed; will retry on next idle",
        );
      }
    }
    return settled;
  }

  return {
    async answer(conversationId, chat = () => rt.readChat(conversationId)) {
      return settleRows(await adapter.pending(conversationId), chat, undefined);
    },

    async sweep() {
      const byConversation = new Map<number, Row[]>();
      for (const row of await adapter.pending()) {
        const rows = byConversation.get(row.conversationId);
        if (rows) rows.push(row);
        else byConversation.set(row.conversationId, [row]);
      }
      let settled = 0;
      for (const [conversationId, rows] of byConversation) {
        if (rt.isBusy(conversationId)) continue;
        try {
          settled += await settleRows(
            rows,
            () => rt.readChat(conversationId),
            (row) => adapter.interrupted(row),
          );
        } catch (error) {
          logger.warn(
            { error, conversationId, kind: adapter.name },
            "Boot sweep of awaited submissions failed",
          );
        }
      }
      return settled;
    },
  };
}
