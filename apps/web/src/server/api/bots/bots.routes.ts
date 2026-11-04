import { Hono } from "hono";
import type { AppEnv } from "@groot/core/types";
import { ok } from "@groot/core/utils/api-response.utils";
import { parseBody, parseQuery, parseStringParam } from "@groot/core/utils/controller.utils";
import { env } from "@groot/core/env";
import { Boom } from "@groot/core/errors";
import { CHAT_WINDOW } from "@tiny-agents/agent";
import { getAgentRuntime } from "./bots.runtime";
import { getConnectionManager } from "../connections/connections.manager";
import * as botsService from "./bots.service";
import * as pastChats from "./chats.history";
import { onBotChatChanged } from "./chats.history";
import { openSse } from "./bots.sse";
import { watchBot } from "./bots.viewers";
import { chatCards, onRoutineCard } from "../routines/routines.cards";
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
  return ok(c, getAgentRuntime().claudeCodeStatus());
});

// Is Claude Code installed and signed in where the worker runs? The first
// call on a sandbox starts installing it; the client polls while it does.
router.get("/claude-code/account", async (c) => {
  return ok(c, await getAgentRuntime().claudeCodeAccount());
});

router.get("/models", (c) => {
  const runtime = getAgentRuntime();
  const models = runtime.listModels();
  const override = env.DEFAULT_MODEL?.trim();
  // The faux provider (dev/E2E) answers without credentials, so it counts as
  // configured; otherwise at least one AI_PROVIDERS provider (the gateway by
  // default) must have its credentials. `gatewayConfigured` keeps its name
  // for existing clients; it means "some provider can answer".
  const providers = runtime.providerStatus();
  const configured = runtime.provider === "faux" || runtime.hasConfiguredProvider();
  return ok(c, {
    models,
    defaultModel: override && runtime.hasModel(override) ? override : models[0]?.id,
    gatewayConfigured: configured,
    providers,
  });
});

// ── Capabilities ──────────────────────────────────────────────────────

router.get("/capabilities", (c) => {
  return ok(c, { capabilities: getAgentRuntime().listCapabilities() });
});

// ── Chat + activity streams (SSE) ─────────────────────────────────────

router.get("/events", (c) =>
  openSse(c, (sse) => {
    const runtime = getAgentRuntime();
    // Snapshot of current busy conversations first, then live changes.
    sse.write({
      type: "activity",
      busy: runtime.busyConversations().map(String),
    });
    sse.onClose(
      runtime.onActivity((change) => {
        sse.write({
          type: "activity",
          conversation: String(change.conversation),
          busy: change.busy,
          approvals: change.approvals,
          questions: change.questions,
        });
      }),
    );
    // Connection status (connected / needs sign-in / error) for the
    // Connections page and the chat banner.
    sse.onClose(
      getConnectionManager().onChange((id, state) => {
        sse.write({ type: "connection", id, ...state });
      }),
    );
  }),
);

router.get("/bots/:id/stream", async (c) => {
  const id = parseStringParam(c.req.param("id"), "id");
  // Before the stream opens (unknown bot) this is a normal API error.
  const bot = await botsService.getBot(id);
  return openSse(c, async (sse) => {
    sse.onClose(watchBot(bot.id));
    // "New chat" or continuing a Past chat moves the bot onto another
    // conversation: this stream watched the old one, so it ends and the
    // client reconnects onto the new one.
    sse.onClose(
      onBotChatChanged((botId) => {
        if (botId === bot.id) sse.end();
      }),
    );
    // Only the newest messages (issue #92): older ones load on scroll from
    // GET /bots/:id/messages, so an open or reconnect stays the same size
    // however long the conversation gets.
    const subscription = await getAgentRuntime().watchChat(
      Number(bot.conversationId),
      (events) => {
        for (const event of events) sse.write(event);
      },
      { window: CHAT_WINDOW },
    );
    sse.onClose(() => void subscription.stop());
    // Routine results (issue #63): cards beside the transcript, not in it.
    // Follow first, then list, so a run finishing in between still arrives
    // (the client dedupes by id).
    sse.onClose(
      onRoutineCard((botId, run) => {
        if (botId === bot.id) sse.write({ type: "routine-run", run });
      }),
    );
    sse.write({ type: "routine-runs", runs: await chatCards(bot.id, bot.chatStartedAt) });
    // YOLO mode of this chat (issue #151): now, and whenever the owner switches it.
    sse.onClose(
      botsService.onYoloChanged((botId, on) => {
        if (botId === bot.id) sse.write({ type: "yolo", on });
      }),
    );
    sse.write({ type: "yolo", on: await botsService.getYolo(bot.id) });
  });
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
  await botsService.sendMessage(id, payload, undefined, c.get("viewer").userId);
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
