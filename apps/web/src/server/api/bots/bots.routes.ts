import { onModelsChanged } from "../models/models.config";
import { routes } from "../routes";
import { ok } from "@groot/core/utils/api-response.utils";
import { parseBody, parseQuery, parseStringParam } from "@groot/core/utils/controller.utils";
import { z } from "zod";
import { Boom } from "@groot/core/errors";
import { getAgentRuntime } from "./bots.runtime";
import { getConnectionManager } from "../connections/connections.manager";
import * as botsService from "./bots.service";
import * as chatsService from "./chats.service";
import * as pastChats from "./chats.history";
import { openSse } from "./bots.sse";
import { followBotChat } from "./bots.stream";
import {
  countsAsWatching,
  followsConversation,
  requireAttachable,
  seesConnections,
} from "../people/access";
import type { BotStreamEvent, EventsFeedEvent } from "../../../shared/bot-stream";
import type {
  CapabilityList,
  ClaudeCodeAccount,
  ClaudeCodeStatus,
  PastChatListData,
  ToolPermissionsData,
} from "../../../shared/api/bots";
import type { ModelsResponse } from "../../../shared/api/models";
import {
  answerQuestionsSchema,
  approvalSchema,
  chatHistorySchema,
  createBotSchema,
  pinBotSchema,
  yoloSchema,
  updateBotSchema,
  sendMessageSchema,
  toolPermissionsSchema,
} from "./bots.schema";
import { ownerToolPermissions, setOwnerToolPermissions } from "./tool-permissions";

const router = routes();

function parseTaskId(value: string | undefined): number {
  const taskId = Number(parseStringParam(value, "taskId"));
  if (!Number.isInteger(taskId) || taskId <= 0) throw Boom.badRequest("Invalid taskId");
  return taskId;
}

router.get("/claude-code/status", (c) => {
  return ok<ClaudeCodeStatus>(c, getAgentRuntime().claudePlan.status());
});

router.get("/claude-code/account", async (c) => {
  return ok<ClaudeCodeAccount>(c, await getAgentRuntime().claudePlan.account());
});

router.get("/models", (c) => {
  const catalog = getAgentRuntime().catalog;
  return ok<ModelsResponse>(c, {
    models: catalog.list({ type: "chat" }),
    defaultModelId: catalog.forRole("bot_default")?.id ?? null,
    canAnswer: catalog.canAnswer(),
    providers: catalog.providers(),
  });
});

router.get("/capabilities", (c) => {
  return ok<CapabilityList>(c, { capabilities: getAgentRuntime().listCapabilities() });
});

router.get("/tool-permissions", async (c) => {
  return ok<ToolPermissionsData>(c, { permissions: await ownerToolPermissions() });
});

router.put("/tool-permissions", "signedIn", async (c) => {
  const { permissions } = await parseBody(c, toolPermissionsSchema);
  const saved = await setOwnerToolPermissions(permissions);
  await botsService.reconcileAllBots();
  return ok<ToolPermissionsData>(c, { permissions: saved });
});

router.get("/events", (c) => {
  const viewer = c.get("viewer");
  const follows = (conversation: string) => followsConversation(viewer, conversation);
  return openSse<EventsFeedEvent>(c, (sse) => {
    const runtime = getAgentRuntime();
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
    sse.onClose(onModelsChanged(() => sse.write({ type: "models.changed" })));
    if (!seesConnections(viewer)) return;
    sse.onClose(
      getConnectionManager().onChange((id, state) => {
        sse.write({ type: "connection", id, ...state });
      }),
    );
  });
});

router.get("/bots/:id/stream", async (c) => {
  const id = parseStringParam(c.req.param("id"), "id");
  const bot = await botsService.getBot(id);
  const watched = countsAsWatching(c.get("viewer"));
  return openSse<BotStreamEvent>(
    c,
    async (sse) => sse.onClose(await followBotChat(bot, sse, undefined, { watched })),
    { botId: bot.id },
  );
});

router.post("/bots", "signedIn", async (c) => {
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

router.patch("/bots/:id", "signedIn", async (c) => {
  const id = parseStringParam(c.req.param("id"), "id");
  const payload = await parseBody(c, updateBotSchema);
  return ok(c, await botsService.updateBot(id, payload));
});

router.delete("/bots/:id", "signedIn", async (c) => {
  const id = parseStringParam(c.req.param("id"), "id");
  return ok(c, await botsService.deleteBot(id));
});

router.get("/bots/:id/messages", async (c) => {
  const id = parseStringParam(c.req.param("id"), "id");
  const query = parseQuery(c, chatHistorySchema);
  return ok(c, await chatsService.chatHistory(id, query));
});

router.post("/bots/:id/messages", "signedIn", async (c) => {
  const id = parseStringParam(c.req.param("id"), "id");
  const payload = await parseBody(c, sendMessageSchema);
  const viewer = c.get("viewer");
  await requireAttachable(viewer, payload.attachments ?? []);
  await chatsService.sendMessage(id, payload, undefined, viewer);
  return ok(c, { submitted: true });
});

router.get("/bots/:id/tools", async (c) => {
  const id = parseStringParam(c.req.param("id"), "id");
  return ok(c, await chatsService.botToolChoices(id));
});

router.delete("/bots/:id/messages/:requestId", "signedIn", async (c) => {
  const id = parseStringParam(c.req.param("id"), "id");
  const requestId = parseStringParam(c.req.param("requestId"), "requestId");
  return ok(c, await chatsService.withdrawMessage(id, { requestId }, c.get("viewer")));
});

router.post("/bots/:id/abort", "signedIn", async (c) => {
  const id = parseStringParam(c.req.param("id"), "id");
  await chatsService.abortReply(id);
  return ok(c, { aborted: true });
});

router.post("/bots/:id/reset", "signedIn", async (c) => {
  const id = parseStringParam(c.req.param("id"), "id");
  return ok(c, await chatsService.resetConversation(id));
});

router.post("/bots/:id/rewind", "signedIn", async (c) => {
  const id = parseStringParam(c.req.param("id"), "id");
  const { at } = await parseBody(c, z.object({ at: z.string().trim().min(1).max(64) }));
  return ok(c, await chatsService.rewindChat(id, at));
});

router.get("/bots/:id/chats", async (c) => {
  const id = parseStringParam(c.req.param("id"), "id");
  await botsService.getBot(id);
  return ok<PastChatListData>(c, { chats: await pastChats.listPastChats(id) });
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

router.post("/bots/:id/chats/:chatId/continue", "signedIn", async (c) => {
  const id = parseStringParam(c.req.param("id"), "id");
  const chatId = parseStringParam(c.req.param("chatId"), "chatId");
  return ok(c, await chatsService.continuePastChat(id, chatId));
});

router.delete("/bots/:id/chats/:chatId", "signedIn", async (c) => {
  const id = parseStringParam(c.req.param("id"), "id");
  const chatId = parseStringParam(c.req.param("chatId"), "chatId");
  return ok(c, await pastChats.deletePastChat(id, chatId));
});

router.post("/bots/:id/approvals/:taskId", "signedIn", async (c) => {
  const id = parseStringParam(c.req.param("id"), "id");
  const taskId = parseTaskId(c.req.param("taskId"));
  const payload = await parseBody(c, approvalSchema);
  await chatsService.decideApproval(id, { taskId, ...payload }, undefined, c.get("viewer"));
  return ok(c, { decided: payload.decision });
});

router.post("/bots/:id/questions/:taskId", "signedIn", async (c) => {
  const id = parseStringParam(c.req.param("id"), "id");
  const taskId = parseTaskId(c.req.param("taskId"));
  const payload = await parseBody(c, answerQuestionsSchema);
  await chatsService.answerQuestions(
    id,
    { taskId, answers: payload.answers ?? null },
    undefined,
    c.get("viewer"),
  );
  return ok(c, payload.answers ? { answered: true } : { dismissed: true });
});

router.post("/bots/:id/pin", "signedIn", async (c) => {
  const id = parseStringParam(c.req.param("id"), "id");
  const payload = await parseBody(c, pinBotSchema);
  return ok(c, await botsService.setPinned(id, payload.pinned));
});

router.put("/bots/:id/yolo", "signedIn", async (c) => {
  const id = parseStringParam(c.req.param("id"), "id");
  const payload = await parseBody(c, yoloSchema);
  return ok(c, await chatsService.setYolo(id, payload.on, c.get("viewer").userId));
});

router.post("/bots/:id/read", "signedIn", async (c) => {
  const id = parseStringParam(c.req.param("id"), "id");
  return ok(c, await botsService.markRead(id, c.get("viewer")));
});

export default router.hono;
