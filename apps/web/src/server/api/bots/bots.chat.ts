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

export function ownerWaitError(error: unknown): unknown {
  for (const [type, toHttp] of OWNER_WAIT_ERRORS) {
    if (error instanceof type) return toHttp(error);
  }
  return error;
}

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
  readonly row: BotWithLinks;
  readonly bot: Bot;
  readonly ref: ConversationRef;
  read(): ReturnType<AgentRuntime["readChat"]>;
  page(query: { before: string; limit: number }): ReturnType<AgentRuntime["readChatPage"]>;
  abort(): Promise<void>;
  withdraw(requestId: string): Promise<{ withdrawn: true }>;
  decideApproval(
    taskId: number,
    decision: "approved" | "denied",
    options?: { grant?: boolean },
  ): Promise<void>;
  setYolo(on: boolean, ownerId: number): ReturnType<AgentRuntime["setYolo"]>;
  answerQuestions(
    taskId: number,
    answers: OwnerAnswer[] | null,
    answeredBy?: string,
  ): Promise<void>;
  dismissPendingQuestions(): Promise<void>;
}

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
    answerQuestions: (taskId, answers, answeredBy) =>
      onOwnerWait(() => rt.answerQuestions(ref, taskId, answers, { answeredBy })),
    async dismissPendingQuestions() {
      if (rt.pendingQuestions(ref) > 0) await rt.dismissQuestions(ref);
    },
  };
}
