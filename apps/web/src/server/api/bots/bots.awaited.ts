/**
 * Awaited submissions (GLOSSARY: Awaited submission): a submission pinned to
 * a conversation, answered by the Finished reply to its request id, or closed
 * as interrupted when a restart cut its turn off. Deliveries and Routine runs
 * are its two adapters; each supplies its own rows and what answering or
 * interrupting one means, and this module owns the rules both follow:
 *
 * - On settle, one read of the chat answers every row awaiting it. A row
 *   whose request is not finished, or not placed yet, waits for a later idle.
 * - At boot the runtime has already resumed every interrupted turn, so a
 *   conversation that is busy is left to its own idle, and one that is idle
 *   with no Finished reply never will have one: the row is interrupted.
 * - Each row is best-effort on its own: a failure is logged and the row is
 *   retried on the next idle or boot.
 */
import { logger } from "@groot/core/logger";
import { finishedReplyTo, type AgentRuntime, type FinishedReply } from "@tiny-agents/agent";
import type { ChatRead } from "./bots.settled";

export interface AwaitedRow {
  /** The submission's request id, which its Finished reply carries. */
  requestId: string;
  /** The conversation it was submitted to. */
  conversationId: number;
}

export interface AwaitedAdapter<Row extends AwaitedRow> {
  /** For logs. */
  name: string;
  /** Rows still awaiting a reply: those of one conversation, or every one (boot). */
  pending(conversationId?: number): Promise<Row[]>;
  answered(row: Row, reply: FinishedReply): Promise<void>;
  interrupted(row: Row): Promise<void>;
}

export interface AwaitedSubmissions {
  /** Answer the rows awaiting a conversation that just settled. Returns how many. */
  answer(conversationId: number, chat?: ChatRead): Promise<number>;
  /** Boot: answer or interrupt the rows on idle conversations. Returns how many. */
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
        // Busy: a resumed turn still running; its own idle answers it.
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
