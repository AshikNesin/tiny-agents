import { onModelsChanged } from "../models/models.config";
import { Hono } from "hono";
import type { AppEnv } from "@groot/core/types";
import { ok } from "@groot/core/utils/api-response.utils";
import { parseBody, parseQuery, parseStringParam } from "@groot/core/utils/controller.utils";
import { Boom } from "@groot/core/errors";
import { getAgentRuntime } from "./bots.runtime";
import { getConnectionManager } from "../connections/connections.manager";
import * as botsService from "./bots.service";
import * as pastChats from "./chats.history";
import { openSse } from "./bots.sse";
import { followBotChat } from "./bots.stream";
import { canReachUpload, followsConversation } from "../people/people.service";
import type { BotStreamEvent, EventsFeedEvent } from "../../../shared/bot-stream";
import {
  answerQuestionsSchema,
  approvalSchema,
  chatHistorySchema,
  createBotSchema,
  pinBotSchema,
  yoloSchema,
  updateBotSchema,
  sendMessageSchema,
} from "./bots.schema";

const router = new Hono<AppEnv>();

/** A positive integer task id route parameter. */
function parseTaskId(value: string | undefined): number {
  const taskId = Number(parseStringParam(value, "taskId"));
  if (!Number.isInteger(taskId) || taskId <= 0) throw Boom.badRequest("Invalid taskId");
  return taskId;
}

// ── Models ────────────────────────────────────────────────────────────

router.get("/claude-code/status", (c) => {
  return ok(c, getAgentRuntime().claudePlan.status());
});

// Is Claude Code installed and signed in where the worker runs? The first
// call on a sandbox starts installing it; the client polls while it does.
router.get("/claude-code/account", async (c) => {
  return ok(c, await getAgentRuntime().claudePlan.account());
});

router.get("/models", (c) => {
  const catalog = getAgentRuntime().catalog;
  return ok(c, {
    // Chat models the picker offers, and any disabled one a bot still uses.
    models: catalog.list({ type: "chat" }),
    defaultModelId: catalog.forRole("bot_default")?.id ?? null,
    canAnswer: catalog.canAnswer(),
    providers: catalog.providers(),
  });
});

// ── Capabilities ──────────────────────────────────────────────────────

router.get("/capabilities", (c) => {
  return ok(c, { capabilities: getAgentRuntime().listCapabilities() });
});

// ── Chat + activity streams (SSE) ─────────────────────────────────────

router.get("/events", (c) => {
  const viewer = c.get("viewer");
  const follows = (conversation: string) => followsConversation(viewer, conversation);
  return openSse<EventsFeedEvent>(c, (sse) => {
    const runtime = getAgentRuntime();
    // Snapshot of current busy conversations first, then live changes.
    sse.write({
      type: "activity",
      busy: runtime.busyConversations().map(String).filter(follows),
    });
    sse.onClose(
      runtime.onActivity((change) => {
        const conversation = String(change.conversation);
        if (!follows(conversation)) return;
        sse.write({
          type: "activity",
          conversation,
          busy: change.busy,
          approvals: change.approvals,
          questions: change.questions,
        });
      }),
    );
    // Guests see model names in the picker too, so they refetch as well.
    sse.onClose(onModelsChanged(() => sse.write({ type: "models.changed" })));
    if (viewer.guest) return;
    sse.onClose(
      getConnectionManager().onChange((id, state) => {
        sse.write({ type: "connection", id, ...state });
      }),
    );
  });
});

router.get("/bots/:id/stream", async (c) => {
  const id = parseStringParam(c.req.param("id"), "id");
  // Before the stream opens (unknown bot) this is a normal API error.
  const bot = await botsService.getBot(id);
  // The stream ends when the bot moves to another chat; the client reconnects onto it.
  // Only the owner's open chat counts as watched: a guest following it must
  // not hold back the owner's pushes (S2).
  const watched = !c.get("viewer").guest;
  return openSse<BotStreamEvent>(
    c,
    async (sse) => sse.onClose(await followBotChat(bot, sse, undefined, { watched })),
    { botId: bot.id },
  );
});

// ── Bots CRUD ─────────────────────────────────────────────────────────

router.post("/bots", async (c) => {
  const payload = await parseBody(c, createBotSchema);
  return ok(c, await botsService.createBot(payload), 201);
});

router.get("/bots", async (c) => {
  return ok(c, await botsService.listBots(undefined, c.get("viewer")));
});

router.get("/bots/:id", async (c) => {
  const id = parseStringParam(c.req.param("id"), "id");
  return ok(c, await botsService.getBot(id));
});

router.patch("/bots/:id", async (c) => {
  const id = parseStringParam(c.req.param("id"), "id");
  const payload = await parseBody(c, updateBotSchema);
  return ok(c, await botsService.updateBot(id, payload));
});

router.delete("/bots/:id", async (c) => {
  const id = parseStringParam(c.req.param("id"), "id");
  return ok(c, await botsService.deleteBot(id));
});

// ── Chat actions ──────────────────────────────────────────────────────

router.get("/bots/:id/messages", async (c) => {
  const id = parseStringParam(c.req.param("id"), "id");
  const query = parseQuery(c, chatHistorySchema);
  return ok(c, await botsService.chatHistory(id, query));
});

router.post("/bots/:id/messages", async (c) => {
  const id = parseStringParam(c.req.param("id"), "id");
  const payload = await parseBody(c, sendMessageSchema);
  const viewer = c.get("viewer");
  for (const uploadId of payload.attachments ?? []) {
    if (!(await canReachUpload(viewer, uploadId, "uploadedOrShared"))) {
      throw Boom.notFound(`Unknown attachment "${uploadId}"`);
    }
  }
  await botsService.sendMessage(id, payload, undefined, viewer.userId);
  return ok(c, { submitted: true });
});

router.delete("/bots/:id/messages/:requestId", async (c) => {
  const id = parseStringParam(c.req.param("id"), "id");
  const requestId = parseStringParam(c.req.param("requestId"), "requestId");
  return ok(c, await botsService.withdrawMessage(id, { requestId }));
});

router.post("/bots/:id/abort", async (c) => {
  const id = parseStringParam(c.req.param("id"), "id");
  await botsService.abortReply(id);
  return ok(c, { aborted: true });
});

router.post("/bots/:id/reset", async (c) => {
  const id = parseStringParam(c.req.param("id"), "id");
  return ok(c, await botsService.resetConversation(id));
});

// ── Past chats (issue #101) ───────────────────────────────────────────

router.get("/bots/:id/chats", async (c) => {
  const id = parseStringParam(c.req.param("id"), "id");
  await botsService.getBot(id);
  return ok(c, { chats: await pastChats.listPastChats(id) });
});

router.get("/bots/:id/chats/:chatId", async (c) => {
  const id = parseStringParam(c.req.param("id"), "id");
  const chatId = parseStringParam(c.req.param("chatId"), "chatId");
  return ok(c, await pastChats.readPastChat(id, chatId, getAgentRuntime()));
});

router.get("/bots/:id/chats/:chatId/messages", async (c) => {
  const id = parseStringParam(c.req.param("id"), "id");
  const chatId = parseStringParam(c.req.param("chatId"), "chatId");
  const query = parseQuery(c, chatHistorySchema);
  return ok(c, await pastChats.pastChatPage(id, chatId, query, getAgentRuntime()));
});

router.post("/bots/:id/chats/:chatId/continue", async (c) => {
  const id = parseStringParam(c.req.param("id"), "id");
  const chatId = parseStringParam(c.req.param("chatId"), "chatId");
  return ok(c, await botsService.continuePastChat(id, chatId));
});

router.delete("/bots/:id/chats/:chatId", async (c) => {
  const id = parseStringParam(c.req.param("id"), "id");
  const chatId = parseStringParam(c.req.param("chatId"), "chatId");
  return ok(c, await pastChats.deletePastChat(id, chatId));
});

router.post("/bots/:id/approvals/:taskId", async (c) => {
  const id = parseStringParam(c.req.param("id"), "id");
  const taskId = parseTaskId(c.req.param("taskId"));
  const payload = await parseBody(c, approvalSchema);
  await botsService.decideApproval(id, { taskId, ...payload }, undefined, c.get("viewer"));
  return ok(c, { decided: payload.decision });
});

router.post("/bots/:id/questions/:taskId", async (c) => {
  const id = parseStringParam(c.req.param("id"), "id");
  const taskId = parseTaskId(c.req.param("taskId"));
  const payload = await parseBody(c, answerQuestionsSchema);
  await botsService.answerQuestions(id, { taskId, answers: payload.answers ?? null });
  return ok(c, payload.answers ? { answered: true } : { dismissed: true });
});

router.post("/bots/:id/pin", async (c) => {
  const id = parseStringParam(c.req.param("id"), "id");
  const payload = await parseBody(c, pinBotSchema);
  return ok(c, await botsService.setPinned(id, payload.pinned));
});

// Owner only: guest.guard.ts does not open it to guests.
router.put("/bots/:id/yolo", async (c) => {
  const id = parseStringParam(c.req.param("id"), "id");
  const payload = await parseBody(c, yoloSchema);
  return ok(c, await botsService.setYolo(id, payload.on, c.get("viewer").userId));
});

router.post("/bots/:id/read", async (c) => {
  const id = parseStringParam(c.req.param("id"), "id");
  return ok(c, await botsService.markRead(id, c.get("viewer")));
});

export default router;
