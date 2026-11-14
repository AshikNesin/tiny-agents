/**
 * Golden flows: bots and their chats, as the owner sees them over HTTP and
 * the chat stream. See recorder.ts.
 */
import { afterAll, beforeAll, describe } from "vite-plus/test";
import { createTestApp } from "../helpers";
import { botChats, botMessages, bots, promptRevisions } from "../../../apps/web/src/server/db";
import { startSettledPipeline } from "../../../apps/web/src/server/api/bots/bots.settled";
import {
  authToken,
  closeAppRuntime,
  openAppRuntime,
  resetAppTables,
  TEST_MODEL,
  until,
} from "../fixtures";
import { goldenFlow, type Recorder } from "./recorder";

const app = createTestApp();
let token = "";
let stopSettled = () => {};

beforeAll(async () => {
  token = await authToken("golden-chats@example.com");
  const runtime = await openAppRuntime();
  stopSettled = startSettledPipeline(runtime);
  await resetAppTables();
});
afterAll(async () => {
  stopSettled();
  await closeAppRuntime();
});

const setup = { app, token: () => token };
const BOT = { description: "Says it back", systemPrompt: "Be brief.", modelId: TEST_MODEL };

/** Until the sidebar shows the bot idle again with a preview: the turn settled. */
async function settled(r: Recorder, botId: string, preview: string) {
  await until(async () => {
    // oxlint-disable-next-line typescript/no-explicit-any -- list rows
    const rows: any[] = (
      await (
        await app.request("/api/v1/bots", { headers: { authorization: `Bearer ${token}` } })
      ).json()
    ).data;
    const row = rows.find((b) => b.id === botId);
    return row && !row.replying && row.lastMessagePreview === preview;
  }, `bot ${botId} settled with "${preview}"`);
  void r;
}

const snapshotDone = (frames: unknown[]) =>
  frames.some((f) => (f as { type: string }).type === "yolo");

describe("golden: bots and chats", () => {
  goldenFlow("bots-crud", setup, async (r) => {
    await r.http("create without a name", "/api/v1/bots", {
      method: "POST",
      json: { ...BOT, name: " " },
    });
    const bot = await r.http("create", "/api/v1/bots", {
      method: "POST",
      json: { ...BOT, name: "Echo" },
    });
    await r.http("create a duplicate name", "/api/v1/bots", {
      method: "POST",
      json: { ...BOT, name: "echo" },
    });
    await r.http("list", "/api/v1/bots");
    await r.http("get", `/api/v1/bots/${bot.id}`);
    await r.http("edit", `/api/v1/bots/${bot.id}`, {
      method: "PATCH",
      json: { name: "Echo Two", systemPrompt: "Be very brief.", memoryEnabled: false },
    });
    await r.http("pin", `/api/v1/bots/${bot.id}/pin`, { method: "POST", json: { pinned: true } });
    await r.http("list pinned", "/api/v1/bots");
    await r.http("unpin", `/api/v1/bots/${bot.id}/pin`, {
      method: "POST",
      json: { pinned: false },
    });
    await r.db("after edits", [bots, promptRevisions]);
    await r.http("delete", `/api/v1/bots/${bot.id}`, { method: "DELETE" });
    await r.http("get deleted", `/api/v1/bots/${bot.id}`);
    await r.http("list after delete", "/api/v1/bots");
  });

  goldenFlow("chat-turn", setup, async (r) => {
    const bot = await r.http("create", "/api/v1/bots", {
      method: "POST",
      json: { ...BOT, name: "Turner" },
    });
    await r.http("send", `/api/v1/bots/${bot.id}/messages`, {
      method: "POST",
      json: { requestId: "golden-turn-0001", text: "hello there" },
    });
    await settled(r, bot.id, "Echo: hello there");
    await r.http("list after the reply", "/api/v1/bots");
    await r.http("history without a cursor", `/api/v1/bots/${bot.id}/messages`);
    await r.http("history before e100", `/api/v1/bots/${bot.id}/messages?before=e100&limit=10`);
    const frames = await r.sse("stream", `/api/v1/bots/${bot.id}/stream`, snapshotDone);
    const newest = (frames[0] as { state: { messages: { id: string }[] } }).state.messages.at(-1)!;
    await r.http(
      "history before the newest",
      `/api/v1/bots/${bot.id}/messages?before=${newest.id}`,
    );
    await r.http("retry the same send", `/api/v1/bots/${bot.id}/messages`, {
      method: "POST",
      json: { requestId: "golden-turn-0001", text: "hello there" },
    });
    await r.http("mark read", `/api/v1/bots/${bot.id}/read`, { method: "POST" });
    await r.http("list after read", "/api/v1/bots");
    await r.http("abort while idle", `/api/v1/bots/${bot.id}/abort`, { method: "POST" });
    await r.http("withdraw unknown", `/api/v1/bots/${bot.id}/messages/nope-nope-nope`, {
      method: "DELETE",
    });
    await r.http("send empty", `/api/v1/bots/${bot.id}/messages`, {
      method: "POST",
      json: { requestId: "short", text: "x" },
    });
    await r.sse("stream after the retry", `/api/v1/bots/${bot.id}/stream`, snapshotDone);
    await r.db("after the turn", [bots, botMessages]);
  });

  goldenFlow("new-chat-and-past-chats", setup, async (r) => {
    const bot = await r.http("create", "/api/v1/bots", {
      method: "POST",
      json: { ...BOT, name: "Historian" },
    });
    await r.http("send", `/api/v1/bots/${bot.id}/messages`, {
      method: "POST",
      json: { requestId: "golden-past-0001", text: "first chat" },
    });
    await settled(r, bot.id, "Echo: first chat");
    await r.http("new chat", `/api/v1/bots/${bot.id}/reset`, { method: "POST" });
    const past = await r.http("past chats", `/api/v1/bots/${bot.id}/chats`);
    const chatId = past.chats[0]?.id;
    await r.http("past chat", `/api/v1/bots/${bot.id}/chats/${chatId}`);
    await r.http(
      "past chat messages",
      `/api/v1/bots/${bot.id}/chats/${chatId}/messages?before=e100`,
    );
    await r.http("send in the new chat", `/api/v1/bots/${bot.id}/messages`, {
      method: "POST",
      json: { requestId: "golden-past-0002", text: "second chat" },
    });
    await settled(r, bot.id, "Echo: second chat");
    await r.http("continue the past chat", `/api/v1/bots/${bot.id}/chats/${chatId}/continue`, {
      method: "POST",
    });
    await r.http("past chats after continue", `/api/v1/bots/${bot.id}/chats`);
    await r.sse("stream on the continued chat", `/api/v1/bots/${bot.id}/stream`, snapshotDone);
    const again = await r.http("past chats now", `/api/v1/bots/${bot.id}/chats`);
    await r.http("delete a past chat", `/api/v1/bots/${bot.id}/chats/${again.chats[0]?.id}`, {
      method: "DELETE",
    });
    await r.db("after the moves", [bots, botChats]);
  });
});
