import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createBotMessagingStore } from "../../../apps/web/src/server/api/bots/bots.messaging";
import { api, createTestApp, type TestApp } from "../helpers";
import {
  authToken,
  createFakeRuntime,
  installFakeRuntime,
  resetAppTables,
  seedBot,
  type FakeRuntime,
} from "../fixtures";

const token = await authToken("u5@example.com");
const SENDER_CHAT = 10_501;

let app: TestApp;
let runtime: FakeRuntime;

beforeEach(async () => {
  runtime = installFakeRuntime(createFakeRuntime());
  runtime.isBusy.mockReturnValue(true);
  await resetAppTables();
  app = createTestApp();
});

afterEach(resetAppTables);

const createBot = (name: string) =>
  api<{ id: string; name: string }>(app, "/api/v1/bots", {
    method: "POST",
    json: { name, modelId: "known-model" },
    token,
  });

describe("U5: bot names are unique ignoring case, but message_bot matches them exactly", () => {
  it("refuses a name differing only in case, yet cannot reach the bot by that name", async () => {
    expect((await createBot("Echo")).status).toBe(201);
    const clash = await createBot("echo");
    expect(clash.status).toBe(409);
    expect(clash.body.error?.message).toBe('A bot named "Echo" already exists');

    await seedBot({ name: "Sender", conversationId: String(SENDER_CHAT) });
    const store = createBotMessagingStore(runtime);
    const send = (toName: string, n: number) =>
      store.deliver({
        conversationId: SENDER_CHAT,
        toName,
        text: "hello",
        requestId: `u5-${n}`,
        sourceKey: `sk-u5-${n}`,
      });

    expect(await send("echo", 1)).toEqual({ delivered: false, reason: "unknown_bot" });
    expect(await send("ECHO", 2)).toEqual({ delivered: false, reason: "unknown_bot" });
    expect(await send(" Echo", 3)).toEqual({ delivered: false, reason: "unknown_bot" });
    expect(await send("Echo", 4)).toMatchObject({ delivered: true });
  });
});
