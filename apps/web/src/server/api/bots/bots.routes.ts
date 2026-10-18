import type { Request, Response } from "express";
import { createRouter } from "@groot/core/utils/router.utils";
import { parseBody, parseStringParam } from "@groot/core/utils/controller.utils";
import { env } from "@groot/core/env";
import { Boom } from "@groot/core/errors";
import { isGatewayConfigured } from "@tiny-agents/agent";
import { getAgentRuntime } from "./bots.runtime";
import { getConnectionManager } from "../connections/connections.manager";
import * as botsService from "./bots.service";
import { initSse, writeSse, endSseOnError } from "./bots.sse";
import { approvalSchema, createBotSchema, updateBotSchema, sendMessageSchema } from "./bots.schema";

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
    subscription = await getAgentRuntime().watchChat(Number(bot.conversationId), (events) => {
      for (const event of events) writeSse(res, event);
    });
    res.on("close", () => {
      heartbeat.stop();
      void subscription?.stop();
    });
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

router.post("/bots/:id/messages", async (req: Request) => {
  const id = parseStringParam(req.params.id, "id");
  const payload = parseBody(req, sendMessageSchema);
  await botsService.sendMessage(id, payload);
  return { submitted: true };
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

router.post("/bots/:id/approvals/:taskId", async (req: Request) => {
  const id = parseStringParam(req.params.id, "id");
  const taskId = Number(parseStringParam(req.params.taskId, "taskId"));
  if (!Number.isInteger(taskId) || taskId <= 0) throw Boom.badRequest("Invalid taskId");
  const payload = parseBody(req, approvalSchema);
  await botsService.decideApproval(id, { taskId, ...payload });
  return { decided: payload.decision };
});

router.post("/bots/:id/read", async (req: Request) => {
  const id = parseStringParam(req.params.id, "id");
  return await botsService.markRead(id);
});

export default router;
