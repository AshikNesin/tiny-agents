/**
 * Traces API (issue #363): sessions with their usage, one session's calls,
 * side-calls, and the 7-day summary, read from what the app already keeps.
 */
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { finishedReplyTo } from "../../../../packages/agent/src/replies";
import { bots, db, llmCalls } from "../../../../apps/web/src/server/db";
import { api, createTestApp, type TestApp } from "../../helpers";
import {
  authToken,
  closeAppRuntime,
  openAppRuntime,
  resetAppTables,
  TEST_MODEL,
  until,
} from "../../fixtures";
import type {
  SideCallList,
  TraceSessionDetail,
  TraceSessionList,
  TraceSummary,
} from "../../../../apps/web/src/shared/api/traces";

const token = await authToken("traces-test@example.com");

describe("Traces API", () => {
  let app: TestApp;

  beforeEach(async () => {
    await resetAppTables();
    app = createTestApp();
  });

  afterEach(closeAppRuntime);

  async function botWithOneTurn() {
    const runtime = await openAppRuntime();
    const created = await api<{ id: string }>(app, "/api/v1/bots", {
      method: "POST",
      json: { name: "Trace bot", modelId: TEST_MODEL },
      token,
    });
    const botId = created.body.data!.id;
    const bot = await db.query.bots.findFirst({ where: eq(bots.id, botId) });
    const ref = Number(bot!.conversationId);
    await runtime.submit(ref, { requestId: "hello", text: "Hello there" });
    await until(
      async () => finishedReplyTo(await runtime.readChat(ref), "hello").status === "answered",
      "the reply",
    );
    return { botId, conversationId: bot!.conversationId };
  }

  it("lists a bot's chat as a session with its tokens and model", async () => {
    const { botId, conversationId } = await botWithOneTurn();
    const response = await api<TraceSessionList>(app, "/api/v1/traces/sessions", { token });
    expect(response.status).toBe(200);
    const { sessions, next } = response.body.data!;
    expect(next).toBeNull();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      id: conversationId,
      kind: "chat",
      bot: { id: botId, name: "Trace bot" },
      harness: "pi",
      usage: { models: [TEST_MODEL] },
    });
    expect(sessions[0]!.usage!.input).toBeGreaterThan(0);

    const chatsOnly = await api<TraceSessionList>(app, "/api/v1/traces/sessions?kind=chats", {
      token,
    });
    expect(chatsOnly.body.data!.sessions.map((s) => s.id)).toEqual([conversationId]);
    const routinesOnly = await api<TraceSessionList>(app, "/api/v1/traces/sessions?kind=routine", {
      token,
    });
    expect(routinesOnly.body.data!.sessions).toEqual([]);
  });

  it("returns one session's turns and calls", async () => {
    const { conversationId } = await botWithOneTurn();
    const response = await api<TraceSessionDetail>(
      app,
      `/api/v1/traces/sessions/${conversationId}`,
      { token },
    );
    expect(response.status).toBe(200);
    const { trace } = response.body.data!;
    expect(trace.turns).toHaveLength(1);
    expect(trace.turns[0]).toMatchObject({
      input: "Hello there",
      steps: [{ type: "llm", model: TEST_MODEL, stopReason: "stop" }],
    });

    const missing = await api(app, "/api/v1/traces/sessions/999999", { token });
    expect(missing.status).toBe(404);
  });

  it("lists side-calls newest first and adds them to the 7-day summary", async () => {
    await openAppRuntime();
    await db.insert(llmCalls).values([
      {
        purpose: "Chat title",
        model: "light",
        inputTokens: 100,
        outputTokens: 10,
        costUsd: 0.01,
        outcome: "ok",
        createdAt: new Date(Date.now() - 60_000),
      },
      {
        purpose: "Memory capture",
        model: "light",
        inputTokens: 300,
        outputTokens: 0,
        costUsd: 0.02,
        outcome: "timeout",
        createdAt: new Date(Date.now() - 1_000),
      },
    ]);
    const list = await api<SideCallList>(app, "/api/v1/traces/side-calls", { token });
    expect(list.body.data!.calls.map((call) => [call.purpose, call.outcome])).toEqual([
      ["Memory capture", "timeout"],
      ["Chat title", "ok"],
    ]);

    const summary = await api<TraceSummary>(app, "/api/v1/traces/summary", { token });
    expect(summary.body.data).toMatchObject({ sessions: 0, sideCalls: 2, tokens: 410 });
    expect(summary.body.data!.costUsd).toBeCloseTo(0.03);
  });
});
