/**
 * Shared bots (issue #145): the owner adds a guest and shares a bot with
 * them; both write in the same chat, the bot reads who said what, and the
 * guest reaches nothing but the bots shared with them and Code.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { db, users } from "../../../apps/web/src/server/db";
import { matchGuestRoute } from "../../../apps/web/src/server/api/people/guest.guard";
import { conversationOwner } from "../../../apps/web/src/server/api/bots/bots.owner";
import { sharedChatGuidance } from "../../../apps/web/src/server/api/bots/bots.conversation";
import { botListStep } from "../../../apps/web/src/server/api/bots/bots.list";
import { isSkipReply, type AgentRuntime } from "../../../packages/agent/src/index";
import { api, createTestApp } from "../helpers";
import {
  authToken,
  closeAppRuntime,
  currentAppRuntime,
  openAppRuntime,
  resetAppTables,
  TEST_MODEL,
  until,
} from "../fixtures";

const app = createTestApp();
const ownerToken = await authToken("sharing-owner@example.com", 990_001);

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- response data varies per route
type Data = any;

function asOwner(path: string, init: { method?: string; json?: unknown } = {}) {
  return api<Data>(app, path, { ...init, token: ownerToken });
}

let guestEmailSeq = 0;

/** Add a guest through the owner's People API; returns their id and a token. */
async function addGuest(name = "Priya") {
  guestEmailSeq += 1;
  const email = `guest-${guestEmailSeq}-${Date.now()}@example.com`;
  const response = await asOwner("/api/v1/people", {
    method: "POST",
    json: { name, email, password: "secret-pass" },
  });
  expect(response.status).toBe(201);
  const id: number = response.body.data.id;
  const token = await authToken(email, id);
  const asGuest = (path: string, init: { method?: string; json?: unknown } = {}) =>
    api<Data>(app, path, { ...init, token });
  return { id, email, asGuest };
}

async function createBot(name: string, extra: Record<string, unknown> = {}) {
  const response = await asOwner("/api/v1/bots", {
    method: "POST",
    json: { name, modelId: TEST_MODEL, systemPrompt: "Be brief.", ...extra },
  });
  expect(response.status).toBe(201);
  return response.body.data as { id: string; conversationId: string; guestIds: number[] };
}

function runtime(): AgentRuntime {
  const current = currentAppRuntime();
  if (current?.kind !== "real") throw new Error("expected the real runtime");
  return current.runtime;
}

describe("shared bots", () => {
  const made: number[] = [];

  beforeEach(async () => {
    await openAppRuntime();
    await resetAppTables();
  });

  afterEach(async () => {
    for (const id of made.splice(0)) await db.delete(users).where(eq(users.id, id));
    vi.restoreAllMocks();
    await closeAppRuntime();
  });

  it("lets a guest see and use only the bots shared with them", async () => {
    const guest = await addGuest();
    made.push(guest.id);
    const shared = await createBot("Shared helper");
    const other = await createBot("Private helper");

    const patched = await asOwner(`/api/v1/bots/${shared.id}`, {
      method: "PATCH",
      json: { guestIds: [guest.id] },
    });
    expect(patched.status).toBe(200);
    expect(patched.body.data.guestIds).toEqual([guest.id]);

    expect((await guest.asGuest("/api/v1/people/me")).body.data).toEqual({ guest: true });
    expect((await asOwner("/api/v1/people/me")).body.data).toEqual({ guest: false });

    const list = await guest.asGuest("/api/v1/bots");
    expect(list.status).toBe(200);
    expect(list.body.data.map((bot: { id: string }) => bot.id)).toEqual([shared.id]);
    // The owner still sees everything.
    expect((await asOwner("/api/v1/bots")).body.data).toHaveLength(2);

    expect((await guest.asGuest(`/api/v1/bots/${shared.id}`)).status).toBe(200);
    expect((await guest.asGuest(`/api/v1/bots/${other.id}`)).status).toBe(404);
    expect((await guest.asGuest(`/api/v1/bots/${other.id}/stream`)).status).toBe(404);
    expect((await guest.asGuest(`/api/v1/bots/${other.id}/browser`)).status).toBe(404);
    expect(
      (
        await guest.asGuest(`/api/v1/bots/${other.id}/messages`, {
          method: "POST",
          json: { requestId: "guest-req-0001", text: "hi" },
        })
      ).status,
    ).toBe(404);

    // Owner pages and edits answer 403.
    for (const [method, path] of [
      ["GET", "/api/v1/tasks"],
      ["GET", "/api/v1/vault"],
      ["GET", "/api/v1/people"],
      ["GET", "/api/v1/settings"],
      ["POST", "/api/v1/bots"],
      ["PATCH", `/api/v1/bots/${shared.id}`],
      ["DELETE", `/api/v1/bots/${shared.id}`],
      ["POST", `/api/v1/bots/${shared.id}/reset`],
      ["GET", `/api/v1/bots/${shared.id}/memories`],
    ] as const) {
      const response = await guest.asGuest(path, {
        method,
        json: method === "GET" ? undefined : {},
      });
      expect(response.status, `${method} ${path}`).toBe(403);
    }
  });

  it("puts both people's messages in one chat, with names for the bot", async () => {
    const guest = await addGuest("Priya");
    made.push(guest.id);
    const bot = await createBot("Team bot");
    await asOwner(`/api/v1/bots/${bot.id}`, { method: "PATCH", json: { guestIds: [guest.id] } });
    const rt = runtime();
    const submit = vi.spyOn(rt, "submit");
    const configure = vi.spyOn(rt, "configure");

    const sent = await guest.asGuest(`/api/v1/bots/${bot.id}/messages`, {
      method: "POST",
      json: { requestId: "guest-req-0002", text: "Can you fix the login test?" },
    });
    expect(sent.status).toBe(200);

    // The bot reads the sender's name; its prompt says who is in the chat.
    expect(submit).toHaveBeenCalledWith(
      Number(bot.conversationId),
      expect.objectContaining({
        text: "Priya: Can you fix the login test?",
        author: { id: guest.id, name: "Priya" },
      }),
    );
    const config = configure.mock.calls.at(-1)?.[1];
    expect(config?.systemPrompt).toContain("Be brief.");
    expect(config?.systemPrompt).toContain("Priya");
    expect(config?.systemPrompt).toContain("[skip]");

    // The transcript shows the words, attributed, without the prefix.
    const chat = await until(async () => {
      const state = await rt.readChat(Number(bot.conversationId));
      return state.messages.some((m) => m.role === "user") ? state : undefined;
    }, "the guest's message");
    const mine = chat.messages.find((m) => m.role === "user");
    expect(mine).toMatchObject({
      text: "Can you fix the login test?",
      author: { id: guest.id, name: "Priya" },
    });

    // The guest's read marker is their own: the owner's row is untouched.
    expect((await guest.asGuest(`/api/v1/bots/${bot.id}/read`, { method: "POST" })).status).toBe(
      200,
    );
  });

  it("keeps a bot nobody shares exactly as before", async () => {
    const bot = await createBot("Solo bot");
    const rt = runtime();
    const submit = vi.spyOn(rt, "submit");
    await asOwner(`/api/v1/bots/${bot.id}/messages`, {
      method: "POST",
      json: { requestId: "owner-req-0003", text: "hello" },
    });
    const input = submit.mock.calls.at(-1)?.[1];
    expect(input?.text).toBe("hello");
    expect(input?.author).toBeUndefined();
  });

  it("turns memory off while a bot is shared", async () => {
    const guest = await addGuest();
    made.push(guest.id);
    const bot = await createBot("Memory bot");
    expect((await conversationOwner(bot.conversationId))?.bot).toMatchObject({
      memoryEnabled: true,
      shared: false,
    });
    await asOwner(`/api/v1/bots/${bot.id}`, { method: "PATCH", json: { guestIds: [guest.id] } });
    expect((await conversationOwner(bot.conversationId))?.bot).toMatchObject({
      memoryEnabled: false,
      shared: true,
    });
  });

  it("refuses sharing with someone who is not a guest", async () => {
    const bot = await createBot("Picky bot");
    const response = await asOwner(`/api/v1/bots/${bot.id}`, {
      method: "PATCH",
      json: { guestIds: [990_001] },
    });
    expect(response.status).toBe(400);
  });

  it("removes a guest and their shares", async () => {
    const guest = await addGuest();
    const bot = await createBot("Leaving bot");
    await asOwner(`/api/v1/bots/${bot.id}`, { method: "PATCH", json: { guestIds: [guest.id] } });
    expect((await asOwner("/api/v1/people")).body.data.guests).toEqual([
      expect.objectContaining({ id: guest.id, botIds: [bot.id] }),
    ]);
    expect((await asOwner(`/api/v1/people/${guest.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await asOwner("/api/v1/people")).body.data.guests).toEqual([]);
    expect((await asOwner(`/api/v1/bots/${bot.id}`)).body.data.guestIds).toEqual([]);
    // An owner account is never removed through People.
    expect((await asOwner("/api/v1/people/990001", { method: "DELETE" })).status).toBe(404);
  });
});

describe("matchGuestRoute", () => {
  it("allows a guest's chat, live views, uploads and Code, and nothing else", () => {
    expect(matchGuestRoute("GET", "/bots")).toEqual({});
    expect(matchGuestRoute("GET", "/bots/b1")).toEqual({ botId: "b1" });
    expect(matchGuestRoute("POST", "/bots/b1/messages")).toEqual({ botId: "b1" });
    expect(matchGuestRoute("DELETE", "/bots/b1/messages/req-1")).toEqual({ botId: "b1" });
    expect(matchGuestRoute("POST", "/bots/b1/approvals/12")).toEqual({ botId: "b1" });
    expect(matchGuestRoute("POST", "/bots/b1/browser/vnc-ticket")).toEqual({ botId: "b1" });
    expect(matchGuestRoute("POST", "/code/threads")).toEqual({});
    expect(matchGuestRoute("POST", "/uploads")).toEqual({});

    expect(matchGuestRoute("PATCH", "/bots/b1")).toBeUndefined();
    // YOLO mode is the owner's switch (issue #151).
    expect(matchGuestRoute("PUT", "/bots/b1/yolo")).toBeUndefined();
    expect(matchGuestRoute("POST", "/bots")).toBeUndefined();
    expect(matchGuestRoute("DELETE", "/bots/b1/browser/profile")).toBeUndefined();
    expect(matchGuestRoute("GET", "/bots/b1/chats")).toBeUndefined();
    expect(matchGuestRoute("GET", "/vault")).toBeUndefined();
    expect(matchGuestRoute("GET", "/terminal/sessions")).toBeUndefined();
    expect(matchGuestRoute("GET", "/people")).toBeUndefined();
  });
});

describe("shared chat replies", () => {
  it("names everyone in the guidance", () => {
    expect(sharedChatGuidance(["Ashik", "Priya"])).toContain("shared by Ashik and Priya");
    expect(sharedChatGuidance(["A", "B", "C"])).toContain("shared by A, B and C");
  });

  it("treats an exact [skip] without tools as silent", () => {
    expect(isSkipReply({ role: "assistant", text: " [skip] " })).toBe(true);
    expect(isSkipReply({ role: "assistant", text: "[skip] but also this" })).toBe(false);
    expect(isSkipReply({ role: "user", text: "[skip]" })).toBe(false);
  });

  it("leaves the Bot list alone after a silent reply", async () => {
    await openAppRuntime();
    await resetAppTables();
    try {
      const bot = await createBot("Quiet bot");
      const before = (await asOwner(`/api/v1/bots/${bot.id}`)).body.data;
      await botListStep().run({
        conversationId: Number(bot.conversationId),
        chat: async () => ({
          messages: [
            {
              id: "e9",
              role: "assistant",
              text: "[skip]",
              status: "done",
              createdAt: Date.now() + 60_000,
            },
          ],
          busy: false,
          queued: [],
        }),
      } as Parameters<ReturnType<typeof botListStep>["run"]>[0]);
      const after = (await asOwner(`/api/v1/bots/${bot.id}`)).body.data;
      expect(after.lastMessagePreview).toBe(before.lastMessagePreview);
      expect(after.lastActivityAt).toBe(before.lastActivityAt);
    } finally {
      await closeAppRuntime();
    }
  });
});
