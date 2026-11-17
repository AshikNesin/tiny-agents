/**
 * Golden flows: turns that wait on the owner (approval cards, Questions) and
 * YOLO mode. The faux model is scripted: a message `/tool NAME {json}` makes
 * one call to NAME with those arguments, then the bot echoes the tool's
 * result; anything else is echoed. See recorder.ts.
 */
import type { Context as PiContext } from "@earendil-works/pi-ai";
import { afterAll, beforeAll, describe } from "vite-plus/test";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "../../../packages/agent/src/testing";
import { createTestApp } from "../helpers";
import { botMessages, tasks } from "../../../apps/web/src/server/db";
import { startSettledPipeline } from "../../../apps/web/src/server/api/bots/bots.settled";
import {
  authToken,
  closeAppRuntime,
  openAppRuntime,
  resetAppTables,
  TEST_MODEL,
  until,
} from "../fixtures";
import { goldenFlow } from "./recorder";

const textOf = (message: PiContext["messages"][number]): string =>
  typeof message.content === "string"
    ? message.content
    : message.content
        .filter((b) => b.type === "text")
        .map((b) => (b as { text: string }).text)
        .join("");

/** The scripted model: one tool round for `/tool NAME {json}`, then an echo. */
function script(context: PiContext) {
  const messages = context.messages;
  let userAt = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === "user") {
      userAt = i;
      break;
    }
  }
  const text = userAt >= 0 ? textOf(messages[userAt]!) : "";
  // One round per user message: once its tool answered, say what it said.
  const result = messages.slice(userAt + 1).find((m) => m.role === "toolResult");
  if (result) return fauxAssistantMessage(fauxText(`Tool said: ${textOf(result)}`));
  const tool = /\/tool (\S+) (\{.*\})\s*$/s.exec(text);
  if (tool) {
    return {
      ...fauxAssistantMessage(fauxToolCall(tool[1]!, JSON.parse(tool[2]!))),
      stopReason: "toolUse" as const,
    };
  }
  return fauxAssistantMessage(fauxText(`Echo: ${text}`));
}

const app = createTestApp();
let token = "";
let stopSettled = () => {};

beforeAll(async () => {
  token = await authToken("golden-turns@example.com");
  const runtime = await openAppRuntime({ respondWith: script });
  stopSettled = startSettledPipeline(runtime);
  await resetAppTables();
});
afterAll(async () => {
  stopSettled();
  await closeAppRuntime();
});

const setup = { app, token: () => token };
const BOT = { description: "", systemPrompt: "Be brief.", modelId: TEST_MODEL };

// oxlint-disable-next-line typescript/no-explicit-any -- list rows
async function listRow(botId: string): Promise<any> {
  const response = await app.request("/api/v1/bots", {
    headers: { authorization: `Bearer ${token}` },
  });
  // oxlint-disable-next-line typescript/no-explicit-any -- list rows
  return ((await response.json()) as { data: any[] }).data.find((b) => b.id === botId);
}

const waitFor = (botId: string, what: string, check: (row: Record<string, unknown>) => boolean) =>
  until(async () => {
    const row = await listRow(botId);
    return row && check(row);
  }, `${what} (bot ${botId})`);

const settledWith = (botId: string, preview: string) =>
  waitFor(
    botId,
    `settled with "${preview}"`,
    (row) => !row.replying && row.lastMessagePreview === preview,
  );

const snapshotDone = (frames: unknown[]) =>
  frames.some((f) => (f as { type: string }).type === "yolo");

/** The waiting call's task id, from the stream's snapshot. */
function waitingTask(frames: unknown[]): number {
  type Call = { taskId?: number; status: string };
  const state = (frames[0] as { state: { messages: { toolCalls?: Call[] }[] } }).state;
  const call = state.messages
    .flatMap((m) => m.toolCalls ?? [])
    .find((c) => c.status === "awaiting_approval" || c.status === "awaiting_answer");
  return call!.taskId!;
}

const improve = (title: string) => `/tool create_task ${JSON.stringify({ title })}`;

describe("golden: turns that wait on the owner", () => {
  goldenFlow("approval-approved", setup, async (r) => {
    const bot = await r.http("create", "/api/v1/bots", {
      method: "POST",
      json: { ...BOT, name: "Improver" },
    });
    await r.http("send", `/api/v1/bots/${bot.id}/messages`, {
      method: "POST",
      json: { requestId: "golden-appr-0001", text: improve("Book flights") },
    });
    await waitFor(bot.id, "an approval waiting", (row) => row.approvals === 1);
    await r.http("list while waiting", "/api/v1/bots");
    const frames = await r.sse(
      "stream with the card",
      `/api/v1/bots/${bot.id}/stream`,
      snapshotDone,
    );
    const taskId = waitingTask(frames);
    await r.http("approve", `/api/v1/bots/${bot.id}/approvals/${taskId}`, {
      method: "POST",
      json: { decision: "approved" },
    });
    await waitFor(bot.id, "settled", (row) => !row.replying && row.approvals === 0);
    await r.http("approve again", `/api/v1/bots/${bot.id}/approvals/${taskId}`, {
      method: "POST",
      json: { decision: "approved" },
    });
    await r.sse("stream after the reply", `/api/v1/bots/${bot.id}/stream`, snapshotDone);
    await r.db("task added", [tasks]);
  });

  goldenFlow("approval-denied", setup, async (r) => {
    const bot = await r.http("create", "/api/v1/bots", {
      method: "POST",
      json: { ...BOT, name: "Denied" },
    });
    await r.http("send", `/api/v1/bots/${bot.id}/messages`, {
      method: "POST",
      json: { requestId: "golden-deny-0001", text: improve("Sell the car") },
    });
    await waitFor(bot.id, "an approval waiting", (row) => row.approvals === 1);
    const frames = await r.sse(
      "stream with the card",
      `/api/v1/bots/${bot.id}/stream`,
      snapshotDone,
    );
    await r.http("deny", `/api/v1/bots/${bot.id}/approvals/${waitingTask(frames)}`, {
      method: "POST",
      json: { decision: "denied" },
    });
    await waitFor(bot.id, "settled", (row) => !row.replying && row.approvals === 0);
    await r.sse("stream after the denial", `/api/v1/bots/${bot.id}/stream`, snapshotDone);
    await r.http("list after", "/api/v1/bots");
    await r.db("no task added", [tasks]);
  });

  goldenFlow("questions-answered-and-dismissed", setup, async (r) => {
    const bot = await r.http("create", "/api/v1/bots", {
      method: "POST",
      json: { ...BOT, name: "Asker" },
    });
    const ask = {
      questions: [
        { question: "Which stack?", options: [{ label: "React" }, { label: "Svelte" }] },
        { question: "Anything else?" },
      ],
    };
    await r.http("send", `/api/v1/bots/${bot.id}/messages`, {
      method: "POST",
      json: { requestId: "golden-ask-00001", text: `/tool ask_owner ${JSON.stringify(ask)}` },
    });
    await waitFor(bot.id, "a question waiting", (row) => row.questions === 1);
    let frames = await r.sse(
      "stream with the question",
      `/api/v1/bots/${bot.id}/stream`,
      snapshotDone,
    );
    await r.http("answer badly", `/api/v1/bots/${bot.id}/questions/${waitingTask(frames)}`, {
      method: "POST",
      json: { answers: [{ selected: ["Vue"] }] },
    });
    await r.http("answer", `/api/v1/bots/${bot.id}/questions/${waitingTask(frames)}`, {
      method: "POST",
      json: { answers: [{ selected: ["Svelte"] }, { selected: [], text: "Keep it small" }] },
    });
    await waitFor(bot.id, "settled", (row) => !row.replying && row.questions === 0);
    await r.sse("stream after the answer", `/api/v1/bots/${bot.id}/stream`, snapshotDone);

    await r.http("ask again", `/api/v1/bots/${bot.id}/messages`, {
      method: "POST",
      json: { requestId: "golden-ask-00002", text: `/tool ask_owner ${JSON.stringify(ask)}` },
    });
    await waitFor(bot.id, "a question waiting", (row) => row.questions === 1);
    frames = await r.sse(
      "stream with the second question",
      `/api/v1/bots/${bot.id}/stream`,
      snapshotDone,
    );
    await r.http("dismiss", `/api/v1/bots/${bot.id}/questions/${waitingTask(frames)}`, {
      method: "POST",
      json: { dismissed: true },
    });
    await waitFor(bot.id, "settled", (row) => !row.replying && row.questions === 0);
    await r.sse("stream after the dismissal", `/api/v1/bots/${bot.id}/stream`, snapshotDone);
  });

  goldenFlow("yolo-runs-without-a-card", setup, async (r) => {
    const bot = await r.http("create", "/api/v1/bots", {
      method: "POST",
      json: { ...BOT, name: "Yolo" },
    });
    await r.http("yolo on", `/api/v1/bots/${bot.id}/yolo`, { method: "PUT", json: { on: true } });
    await r.http("send", `/api/v1/bots/${bot.id}/messages`, {
      method: "POST",
      json: {
        requestId: "golden-yolo-0001",
        text: `/tool create_task ${JSON.stringify({ title: "Buy milk" })}`,
      },
    });
    await waitFor(bot.id, "settled", (row) => !row.replying && row.lastMessagePreview !== null);
    await r.sse("stream after the run", `/api/v1/bots/${bot.id}/stream`, snapshotDone);
    await r.http("yolo off", `/api/v1/bots/${bot.id}/yolo`, { method: "PUT", json: { on: false } });
    await r.db("tasks", [tasks]);
  });

  goldenFlow("allowed-tool-runs-and-preview", setup, async (r) => {
    const bot = await r.http("create", "/api/v1/bots", {
      method: "POST",
      json: { ...BOT, name: "Tasker", toolPermissions: { create_task: "allow" } },
    });
    await r.http("send", `/api/v1/bots/${bot.id}/messages`, {
      method: "POST",
      json: {
        requestId: "golden-task-0001",
        text: `/tool create_task ${JSON.stringify({ title: "Call mom" })}`,
      },
    });
    await waitFor(bot.id, "settled", (row) => !row.replying && row.lastMessagePreview !== null);
    await r.http("list", "/api/v1/bots");
    await r.http("tasks", "/api/v1/tasks");
    await r.sse("stream", `/api/v1/bots/${bot.id}/stream`, snapshotDone);
  });

  goldenFlow("queue-steer-and-withdraw-while-waiting", setup, async (r) => {
    const bot = await r.http("create", "/api/v1/bots", {
      method: "POST",
      json: { ...BOT, name: "Busy" },
    });
    await r.http("send", `/api/v1/bots/${bot.id}/messages`, {
      method: "POST",
      json: { requestId: "golden-busy-0001", text: improve("Water plants") },
    });
    await waitFor(bot.id, "an approval waiting", (row) => row.approvals === 1);
    const send = (name: string, requestId: string, text: string, whenBusy?: string) =>
      r.http(name, `/api/v1/bots/${bot.id}/messages`, {
        method: "POST",
        json: { requestId, text, ...(whenBusy ? { whenBusy } : {}) },
      });
    await send("queue a follow-up", "golden-busy-0002", "after that, thanks");
    await send("queue one to withdraw", "golden-busy-0003", "never mind this");
    await send("steer", "golden-busy-0004", "also make it weekly", "steer");
    const frames = await r.sse("stream while busy", `/api/v1/bots/${bot.id}/stream`, snapshotDone);
    await r.http("withdraw the queued one", `/api/v1/bots/${bot.id}/messages/golden-busy-0003`, {
      method: "DELETE",
    });
    await r.http("approve", `/api/v1/bots/${bot.id}/approvals/${waitingTask(frames)}`, {
      method: "POST",
      json: { decision: "approved" },
    });
    await waitFor(
      bot.id,
      "the follow-up answered",
      (row) => !row.replying && row.lastMessagePreview === "Echo: after that, thanks",
    );
    await r.sse("stream after both runs", `/api/v1/bots/${bot.id}/stream`, snapshotDone);
    await r.http("withdraw after it ran", `/api/v1/bots/${bot.id}/messages/golden-busy-0002`, {
      method: "DELETE",
    });
  });

  goldenFlow("bot-to-bot-and-mentions", setup, async (r) => {
    const host = await r.http("create the host", "/api/v1/bots", {
      method: "POST",
      json: { ...BOT, name: "Host", toolPermissions: { message_bot: "allow" } },
    });
    const helper = await r.http("create the helper", "/api/v1/bots", {
      method: "POST",
      json: { ...BOT, name: "Helper" },
    });
    await r.http("host messages the helper", `/api/v1/bots/${host.id}/messages`, {
      method: "POST",
      json: {
        requestId: "golden-b2b-00001",
        text: `/tool message_bot ${JSON.stringify({ to: "Helper", text: "what is 2+2?" })}`,
      },
    });
    // The helper answers in a conversation of its own, not its chat: only
    // the relayed reply shows, in the host's chat.
    await waitFor(host.id, "the relay answered", (row) =>
      String(row.lastMessagePreview ?? "").startsWith("Echo: **Reply from Helper:**"),
    );
    await r.sse("host chat", `/api/v1/bots/${host.id}/stream`, snapshotDone);
    await r.sse("helper chat", `/api/v1/bots/${helper.id}/stream`, snapshotDone);

    await r.http("owner mentions the helper", `/api/v1/bots/${host.id}/messages`, {
      method: "POST",
      json: { requestId: "golden-b2b-00002", text: "@Helper say hi", mentions: [helper.id] },
    });
    await waitFor(
      helper.id,
      "the helper answered the mention",
      (row) => String(row.lastMessagePreview ?? "").includes("say hi") && !row.replying,
    );
    await until(async () => {
      const { db } = await import("../../../apps/web/src/server/db");
      const rows = await db.select().from(botMessages);
      return rows.length === 2 && rows.every((row) => row.answeredAt !== null);
    }, "both deliveries answered");
    await waitFor(host.id, "the host settled", (row) => !row.replying);
    await r.sse("host chat after the mention", `/api/v1/bots/${host.id}/stream`, snapshotDone);
    await r.http("list", "/api/v1/bots");
    await r.db("deliveries", [botMessages]);
  });
  void settledWith;
});
