/**
 * The bot chat handle (bots.chat.ts): one lookup resolves the bot's current
 * conversation, every action acts on that ref, and Owner-wait errors answer
 * as HTTP from one table. Real SQLite test DB; the runtime is a stub.
 */
import { HttpError } from "@groot/core/errors";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  ApprovalNotPendingError,
  CredentialRequestNotPendingError,
  InvalidAnswersError,
  QuestionNotPendingError,
} from "../../../../packages/agent/src/index";
import {
  openBotChat,
  ownerWaitError,
  type BotChatRuntime,
} from "../../../../apps/web/src/server/api/bots/bots.chat";
import { resetAppTables, seedBot } from "../../fixtures";

function stubRuntime(): { [K in keyof BotChatRuntime]: ReturnType<typeof vi.fn> } {
  return {
    readChat: vi.fn(async () => ({ messages: [] })),
    readChatPage: vi.fn(async () => undefined),
    abort: vi.fn(async () => {}),
    withdraw: vi.fn(async () => "withdrawn"),
    decideApproval: vi.fn(async () => {}),
    setYolo: vi.fn(async (_ref: number, on: boolean) => ({ on, approved: [] })),
    answerQuestions: vi.fn(async () => {}),
    pendingQuestions: vi.fn(() => 0),
    dismissQuestions: vi.fn(async () => {}),
  };
}

function httpOf(error: unknown): { status: number; message: string } {
  expect(error).toBeInstanceOf(HttpError);
  const http = error as HttpError;
  return { status: http.statusCode, message: http.message };
}

describe("ownerWaitError", () => {
  it("translates each Owner-wait error to its HTTP status, keeping the message", () => {
    expect(httpOf(ownerWaitError(new ApprovalNotPendingError(4)))).toEqual({
      status: 409,
      message: "Tool call 4 is not waiting for approval",
    });
    expect(httpOf(ownerWaitError(new QuestionNotPendingError(5)))).toEqual({
      status: 409,
      message: "Tool call 5 is not waiting for answers",
    });
    expect(httpOf(ownerWaitError(new InvalidAnswersError("Answer every question")))).toEqual({
      status: 400,
      message: "Answer every question",
    });
    expect(httpOf(ownerWaitError(new CredentialRequestNotPendingError(6)))).toEqual({
      status: 404,
      message: "This request was answered, cancelled or expired",
    });
  });

  it("passes any other error through as it is", () => {
    const other = new Error("boom");
    expect(ownerWaitError(other)).toBe(other);
  });
});

describe("openBotChat", () => {
  let rt: ReturnType<typeof stubRuntime>;
  beforeEach(async () => {
    await resetAppTables();
    rt = stubRuntime();
  });
  afterEach(resetAppTables);

  it("404s an unknown bot", async () => {
    const error = await openBotChat("missing", rt as never).catch((e: unknown) => e);
    expect(httpOf(error)).toEqual({ status: 404, message: "Bot not found" });
  });

  it("resolves the bot's conversation once and acts on that ref", async () => {
    const bot = await seedBot({ conversationId: "42" });
    const chat = await openBotChat(bot.id, rt as never);
    expect(chat.ref).toBe(42);
    expect(chat.bot.id).toBe(bot.id);
    await chat.abort();
    await chat.decideApproval(3, "approved", { grant: true });
    await chat.setYolo(true, 1);
    expect(rt.abort).toHaveBeenCalledWith(42);
    expect(rt.decideApproval).toHaveBeenCalledWith(42, 3, "approved", { grant: true });
    expect(rt.setYolo).toHaveBeenCalledWith(42, true, 1);
  });

  it("answers the runtime's Owner-wait errors as HTTP", async () => {
    const bot = await seedBot({ conversationId: "42" });
    const chat = await openBotChat(bot.id, rt as never);
    rt.decideApproval.mockRejectedValueOnce(new ApprovalNotPendingError(3));
    expect(httpOf(await chat.decideApproval(3, "denied").catch((e: unknown) => e)).status).toBe(
      409,
    );
    rt.answerQuestions.mockRejectedValueOnce(new InvalidAnswersError("bad"));
    expect(httpOf(await chat.answerQuestions(3, []).catch((e: unknown) => e)).status).toBe(400);
    rt.answerQuestions.mockRejectedValueOnce(new QuestionNotPendingError(3));
    expect(httpOf(await chat.answerQuestions(3, null).catch((e: unknown) => e)).status).toBe(409);
  });

  it("maps withdraw outcomes and an unknown page cursor", async () => {
    const bot = await seedBot({ conversationId: "42" });
    const chat = await openBotChat(bot.id, rt as never);
    expect(await chat.withdraw("r1")).toEqual({ withdrawn: true });
    rt.withdraw.mockResolvedValueOnce("not_found");
    expect(httpOf(await chat.withdraw("r2").catch((e: unknown) => e))).toEqual({
      status: 404,
      message: "Message not found",
    });
    rt.withdraw.mockResolvedValueOnce("placed");
    expect(httpOf(await chat.withdraw("r3").catch((e: unknown) => e))).toEqual({
      status: 409,
      message: "Message is no longer queued",
    });
    expect(httpOf(await chat.page({ before: "x", limit: 10 }).catch((e: unknown) => e))).toEqual({
      status: 400,
      message: "Unknown message cursor",
    });
  });

  it("dismisses questions only when the bot is waiting on some", async () => {
    const bot = await seedBot({ conversationId: "42" });
    const chat = await openBotChat(bot.id, rt as never);
    await chat.dismissPendingQuestions();
    expect(rt.dismissQuestions).not.toHaveBeenCalled();
    rt.pendingQuestions.mockReturnValue(2);
    await chat.dismissPendingQuestions();
    expect(rt.dismissQuestions).toHaveBeenCalledWith(42);
  });
});
