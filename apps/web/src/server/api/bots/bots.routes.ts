import type { Request, Response } from "express";
import { createRouter } from "@groot/core/utils/router.utils";
import { parseBody, parseQuery, parseStringParam } from "@groot/core/utils/controller.utils";
import { env } from "@groot/core/env";
import { Boom } from "@groot/core/errors";
import { CHAT_WINDOW, isGatewayConfigured } from "@tiny-agents/agent";
import { getAgentRuntime } from "./bots.runtime";
import { getConnectionManager } from "../connections/connections.manager";
import * as botsService from "./bots.service";
import * as pastChats from "./chats.history";
import { initSse, writeSse, endSseOnError } from "./bots.sse";
import { watchBot } from "./bots.viewers";
import { chatCards, onRoutineCard } from "../routines/routines.cards";
import {
  answerQuestionsSchema,
  approvalSchema,
  chatHistorySchema,
  createBotSchema,
  pinBotSchema,
  updateBotSchema,
  sendMessageSchema,
} from "./bots.schema";

const router = createRouter();

// ── Models ────────────────────────────────────────────────────────────

router.get("/models", async () => {
  const runtime = getAgentRuntime();
  const models = runtime.listModels();
  const override = env.DEFAULT_MODEL?.trim();
  // The faux provider (dev/E2E) answers without the gateway, so it counts as
  // configured; otherwise the real gateway env vars must all be present.
  const configured = runtime.provider === "faux" || isGatewayConfigured();
  return {
    models,
    defaultModel: override && runtime.hasModel(override) ? override : models[0]?.id,
    gatewayConfigured: configured,
  };
});

// ── Capabilities ──────────────────────────────────────────────────────

router.get("/capabilities", async () => {
  return { capabilities: getAgentRuntime().listCapabilities() };
});

// ── Chat + activity streams (SSE; must be registered before /bots/:id) ─

router.get("/events", async (req: Request, res: Response) => {
  const heartbeat = initSse(res);
  const runtime = getAgentRuntime();
  // Snapshot of current busy conversations first, then live changes.
  writeSse(res, {
    type: "activity",
    busy: runtime.busyConversations().map(String),
  });
  const unsubscribe = runtime.onActivity((change) => {
    writeSse(res, {
      type: "activity",
      conversation: String(change.conversation),
      busy: change.busy,
      approvals: change.approvals,
      questions: change.questions,
    });
  });
  // Connection status (connected / needs sign-in / error) for the
  // Connections page and the chat banner.
  const unsubscribeConnections = getConnectionManager().onChange((id, state) => {
    writeSse(res, { type: "connection", id, ...state });
  });
  const close = () => {
    heartbeat.stop();
    unsubscribe();
    unsubscribeConnections();
  };
  res.on("close", close);
  // SSE owns the response lifecycle; returning `undefined` lets the route
  // handler wrapper no-op once headers are sent.
  return undefined;
});

router.get("/bots/:id/stream", async (req: Request, res: Response) => {
  const id = parseStringParam(req.params.id, "id");
  let subscription: { stop(): Promise<void> } | undefined;
  try {
    const bot = await botsService.getBot(id);
    const heartbeat = initSse(res);
    const unwatch = watchBot(bot.id);
    res.on("close", unwatch);
    // Only the newest messages (issue #92): older ones load on scroll from
    // GET /bots/:id/messages, so an open or reconnect stays the same size
    // however long the conversation gets.
    subscription = await getAgentRuntime().watchChat(
      Number(bot.conversationId),
      (events) => {
        for (const event of events) writeSse(res, event);
      },
      { window: CHAT_WINDOW },
    );
    // Routine results (issue #63): cards beside the transcript, not in it.
    // Follow first, then list, so a run finishing in between still arrives
    // (the client dedupes by id).
    const unfollow = onRoutineCard((botId, run) => {
      if (botId === bot.id) writeSse(res, { type: "routine-run", run });
    });
    res.on("close", () => {
      heartbeat.stop();
      unfollow();
      void subscription?.stop();
    });
    writeSse(res, { type: "routine-runs", runs: await chatCards(bot.id, bot.chatStartedAt) });
  } catch (error) {
    // Before headers were sent (unknown bot) this is a normal API error.
    if (!res.headersSent) throw error;
    endSseOnError(res, error);
  }
  return undefined;
});

// ── Bots CRUD ─────────────────────────────────────────────────────────

router.post("/bots", async (req: Request, res: Response) => {
  const payload = parseBody(req, createBotSchema);
  res.status(201);
  return await botsService.createBot(payload);
});

router.get("/bots", async () => {
  return await botsService.listBots();
});

router.get("/bots/:id", async (req: Request) => {
  const id = parseStringParam(req.params.id, "id");
  return await botsService.getBot(id);
});

router.patch("/bots/:id", async (req: Request) => {
  const id = parseStringParam(req.params.id, "id");
  const payload = parseBody(req, updateBotSchema);
  return await botsService.updateBot(id, payload);
});

router.delete("/bots/:id", async (req: Request) => {
  const id = parseStringParam(req.params.id, "id");
  return await botsService.deleteBot(id);
});

// ── Chat actions ──────────────────────────────────────────────────────

router.get("/bots/:id/messages", async (req: Request) => {
  const id = parseStringParam(req.params.id, "id");
  const query = parseQuery(req, chatHistorySchema);
  return await botsService.chatHistory(id, query);
});

router.post("/bots/:id/messages", async (req: Request) => {
  const id = parseStringParam(req.params.id, "id");
  const payload = parseBody(req, sendMessageSchema);
  await botsService.sendMessage(id, payload);
  return { submitted: true };
});

router.delete("/bots/:id/messages/:requestId", async (req: Request) => {
  const id = parseStringParam(req.params.id, "id");
  const requestId = parseStringParam(req.params.requestId, "requestId");
  return await botsService.withdrawMessage(id, { requestId });
});

router.post("/bots/:id/abort", async (req: Request) => {
  const id = parseStringParam(req.params.id, "id");
  await botsService.abortReply(id);
  return { aborted: true };
});

router.post("/bots/:id/reset", async (req: Request) => {
  const id = parseStringParam(req.params.id, "id");
  return await botsService.resetConversation(id);
});

// ── Past chats (issue #101) ───────────────────────────────────────────

router.get("/bots/:id/chats", async (req: Request) => {
  const id = parseStringParam(req.params.id, "id");
  await botsService.getBot(id);
  return { chats: await pastChats.listPastChats(id) };
});

router.get("/bots/:id/chats/:chatId", async (req: Request) => {
  const id = parseStringParam(req.params.id, "id");
  const chatId = parseStringParam(req.params.chatId, "chatId");
  return await pastChats.readPastChat(id, chatId, getAgentRuntime());
});

router.get("/bots/:id/chats/:chatId/messages", async (req: Request) => {
  const id = parseStringParam(req.params.id, "id");
  const chatId = parseStringParam(req.params.chatId, "chatId");
  const query = parseQuery(req, chatHistorySchema);
  return await pastChats.pastChatPage(id, chatId, query, getAgentRuntime());
});

router.post("/bots/:id/chats/:chatId/continue", async (req: Request) => {
  const id = parseStringParam(req.params.id, "id");
  const chatId = parseStringParam(req.params.chatId, "chatId");
  return await botsService.continuePastChat(id, chatId);
});

router.delete("/bots/:id/chats/:chatId", async (req: Request) => {
  const id = parseStringParam(req.params.id, "id");
  const chatId = parseStringParam(req.params.chatId, "chatId");
  return await pastChats.deletePastChat(id, chatId);
});

router.post("/bots/:id/approvals/:taskId", async (req: Request) => {
  const id = parseStringParam(req.params.id, "id");
  const taskId = Number(parseStringParam(req.params.taskId, "taskId"));
  if (!Number.isInteger(taskId) || taskId <= 0) throw Boom.badRequest("Invalid taskId");
  const payload = parseBody(req, approvalSchema);
  await botsService.decideApproval(id, { taskId, ...payload });
  return { decided: payload.decision };
});

router.post("/bots/:id/questions/:taskId", async (req: Request) => {
  const id = parseStringParam(req.params.id, "id");
  const taskId = Number(parseStringParam(req.params.taskId, "taskId"));
  if (!Number.isInteger(taskId) || taskId <= 0) throw Boom.badRequest("Invalid taskId");
  const payload = parseBody(req, answerQuestionsSchema);
  await botsService.answerQuestions(id, { taskId, answers: payload.answers ?? null });
  return payload.answers ? { answered: true } : { dismissed: true };
});

router.post("/bots/:id/pin", async (req: Request) => {
  const id = parseStringParam(req.params.id, "id");
  const payload = parseBody(req, pinBotSchema);
  return await botsService.setPinned(id, payload.pinned);
});

router.post("/bots/:id/read", async (req: Request) => {
  const id = parseStringParam(req.params.id, "id");
  return await botsService.markRead(id);
});

export default router;
