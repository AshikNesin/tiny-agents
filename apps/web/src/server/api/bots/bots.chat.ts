/**
 * A bot chat: the owner's actions on the conversation a bot is on now.
 * `openBotChat` looks the bot up once (404 for an unknown one) and resolves
 * its current conversation to a `ConversationRef`; the handle's actions all
 * act on that ref, so no caller repeats the lookup or the conversion.
 *
 * An Owner wait the runtime no longer holds (an approval, a question or a
 * credential request already answered, cancelled or expired), or answers
 * that do not fit their questions, is translated to HTTP in one table,
 * `OWNER_WAIT_ERRORS`, which the vault's credential requests use too.
 */
import { Boom, type HttpError } from "@groot/core/errors";
import {
  ApprovalNotPendingError,
  CredentialRequestNotPendingError,
  InvalidAnswersError,
  QuestionNotPendingError,
  type AgentRuntime,
  type ConversationRef,
  type OwnerAnswer,
} from "@tiny-agents/agent";
import {
  conversationRef,
  findBotRow,
  toBot,
  type Bot,
  type BotWithLinks,
} from "./bots.conversation";

/** Owner-wait errors and the HTTP error each answers as. */
const OWNER_WAIT_ERRORS: ReadonlyArray<
  readonly [new (...args: never[]) => Error, (error: Error) => HttpError]
> = [
  [ApprovalNotPendingError, (error) => Boom.conflict(error.message)],
  [QuestionNotPendingError, (error) => Boom.conflict(error.message)],
  [InvalidAnswersError, (error) => Boom.badRequest(error.message)],
  [
    CredentialRequestNotPendingError,
    () => Boom.notFound("This request was answered, cancelled or expired"),
  ],
];

/** The HTTP error an Owner-wait error answers as; any other error as it is. */
export function ownerWaitError(error: unknown): unknown {
  for (const [type, toHttp] of OWNER_WAIT_ERRORS) {
    if (error instanceof type) return toHttp(error);
  }
  return error;
}

/** Run an action on an Owner wait, its runtime errors translated to HTTP. */
export async function onOwnerWait<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    throw ownerWaitError(error);
  }
}

export type BotChatRuntime = Pick<
  AgentRuntime,
  | "readChat"
  | "readChatPage"
  | "abort"
  | "withdraw"
  | "decideApproval"
  | "setYolo"
  | "answerQuestions"
  | "pendingQuestions"
  | "dismissQuestions"
>;

export interface BotChat {
  /** The bot's row with its links, as looked up. */
  readonly row: BotWithLinks;
  readonly bot: Bot;
  /** The conversation the bot is on now. */
  readonly ref: ConversationRef;
  read(): ReturnType<AgentRuntime["readChat"]>;
  /** Transcript messages older than `query.before`; 400 for an unknown cursor. */
  page(query: { before: string; limit: number }): ReturnType<AgentRuntime["readChatPage"]>;
  abort(): Promise<void>;
  /** Withdraw a queued message: 404 when unknown, 409 once it is part of the reply. */
  withdraw(requestId: string): Promise<{ withdrawn: true }>;
  decideApproval(
    taskId: number,
    decision: "approved" | "denied",
    options?: { grant?: boolean },
  ): Promise<void>;
  setYolo(on: boolean, ownerId: number): ReturnType<AgentRuntime["setYolo"]>;
  /** Answer the bot's questions, or dismiss them with `null`. */
  answerQuestions(taskId: number, answers: OwnerAnswer[] | null): Promise<void>;
  /** Dismiss the questions the bot is waiting on, if any. */
  dismissPendingQuestions(): Promise<void>;
}

/** The chat a bot is on now. 404 for an unknown bot. */
export async function openBotChat(id: string, rt: BotChatRuntime): Promise<BotChat> {
  const row = await findBotRow(id);
  const ref = conversationRef(row.conversationId);
  return {
    row,
    bot: toBot(row),
    ref,
    read: () => rt.readChat(ref),
    async page(query) {
      const page = await rt.readChatPage(ref, query);
      if (!page) throw Boom.badRequest("Unknown message cursor");
      return page;
    },
    abort: () => rt.abort(ref),
    async withdraw(requestId) {
      const outcome = await rt.withdraw(ref, requestId);
      if (outcome === "not_found") throw Boom.notFound("Message not found");
      if (outcome !== "withdrawn") throw Boom.conflict("Message is no longer queued");
      return { withdrawn: true };
    },
    decideApproval: (taskId, decision, options) =>
      onOwnerWait(() =>
        options?.grant
          ? rt.decideApproval(ref, taskId, decision, { grant: true })
          : rt.decideApproval(ref, taskId, decision),
      ),
    setYolo: (on, ownerId) => rt.setYolo(ref, on, ownerId),
    answerQuestions: (taskId, answers) =>
      onOwnerWait(() => rt.answerQuestions(ref, taskId, answers)),
    async dismissPendingQuestions() {
      if (rt.pendingQuestions(ref) > 0) await rt.dismissQuestions(ref);
    },
  };
}
