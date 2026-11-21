import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { db, users } from "../../../apps/web/src/server/db";
import { matchGuestRoute } from "../../../apps/web/src/server/api/people/guest.guard";
import { conversationOwner } from "../../../apps/web/src/server/api/bots/bots.owner";
import { sharedChatGuidance } from "../../../apps/web/src/server/api/bots/bots.conversation";
import { botListStep } from "../../../apps/web/src/server/api/bots/bots.list";
import {
  getConnectionManager,
  type ConnectionLiveState,
} from "../../../apps/web/src/server/api/connections/connections.manager";
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
  return { id, email, token, asGuest };
}

type ActivityChange = Parameters<Parameters<AgentRuntime["onActivity"]>[0]>[0];

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

async function upload(token: string, name: string): Promise<string> {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(TINY_PNG)], name, { type: "image/png" }));
  const response = await api<Data>(app, "/api/v1/uploads", { method: "POST", body: form, token });
  expect(response.status).toBe(200);
  return response.body.data.ref.uploadId;
}

async function readEvents(
  token: string,
  onFirstEvent: () => void,
  until: string,
): Promise<unknown[]> {
  const response = await app.request("/api/v1/events", { headers: bearer(token) });
  expect(response.status).toBe(200);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let opened = false;
  try {
    while (!text.includes(until)) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      if (!opened && text.includes("data:")) {
        opened = true;
        onFirstEvent();
      }
    }
  } finally {
    await reader.cancel();
  }
  return text
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => JSON.parse(line.slice("data:".length)) as { type: string })
    .filter((event) => event.type !== "ping");
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

  it("lets a guest read only uploads they made or that sit in a chat shared with them", async () => {
    const guest = await addGuest();
    made.push(guest.id);
    const shared = await createBot("Shared files");
    await asOwner(`/api/v1/bots/${shared.id}`, {
      method: "PATCH",
      json: { guestIds: [guest.id] },
    });
    const ownerPrivate = await upload(ownerToken, "private.png");
    const ownerShared = await upload(ownerToken, "shared.png");
    const guestOwn = await upload(guest.token, "mine.png");
    const send = (as: typeof asOwner, requestId: string, attachments: string[]) =>
      as(`/api/v1/bots/${shared.id}/messages`, {
        method: "POST",
        json: { requestId, text: "see attached", attachments },
      });
    expect((await send(asOwner, "owner-files-01", [ownerShared])).status).toBe(200);

    const reads = async (id: string) => [
      (await guest.asGuest(`/api/v1/uploads/${id}`)).status,
      (await app.request(`/api/v1/uploads/${id}/content`, { headers: bearer(guest.token) })).status,
      (await guest.asGuest(`/api/v1/uploads/${id}/text`)).status,
    ];
    expect(await reads(ownerPrivate)).toEqual([404, 404, 404]);
    expect(await reads(ownerShared)).toEqual([200, 200, 200]);
    expect(await reads(guestOwn)).toEqual([200, 200, 200]);

    expect((await send(guest.asGuest, "guest-files-01", [ownerPrivate])).status).toBe(404);
    expect(await reads(ownerPrivate)).toEqual([404, 404, 404]);
    expect((await send(guest.asGuest, "guest-files-02", [guestOwn])).status).toBe(200);

    for (const id of [ownerPrivate, ownerShared]) {
      expect((await guest.asGuest(`/api/v1/uploads/${id}`, { method: "DELETE" })).status).toBe(404);
      expect((await asOwner(`/api/v1/uploads/${id}`)).status).toBe(200);
    }
    expect((await guest.asGuest(`/api/v1/uploads/${guestOwn}`, { method: "DELETE" })).status).toBe(
      200,
    );
  });

  it("streams a guest the activity of shared bots only, and no connection state", async () => {
    const guest = await addGuest();
    made.push(guest.id);
    const shared = await createBot("Shared busy");
    const other = await createBot("Private busy");
    await asOwner(`/api/v1/bots/${shared.id}`, {
      method: "PATCH",
      json: { guestIds: [guest.id] },
    });
    const rt = runtime();
    const activity = new Set<(change: ActivityChange) => void>();
    vi.spyOn(rt, "onActivity").mockImplementation((listener) => {
      activity.add(listener);
      return () => activity.delete(listener);
    });
    vi.spyOn(rt, "busyConversations").mockReturnValue([
      Number(other.conversationId),
      Number(shared.conversationId),
    ]);
    const connections = new Set<(id: string, state: ConnectionLiveState) => void>();
    vi.spyOn(getConnectionManager(), "onChange").mockImplementation((listener) => {
      connections.add(listener);
      return () => connections.delete(listener);
    });
    const emit = () => {
      for (const listener of connections) listener("owner-mcp", { status: "connected" });
      for (const conversation of [other.conversationId, shared.conversationId]) {
        for (const listener of activity) {
          listener({ conversation: Number(conversation), busy: true, approvals: 1, questions: 0 });
        }
      }
    };

    const seen = await readEvents(guest.token, emit, `"conversation":"${shared.conversationId}"`);
    expect(seen).toEqual([
      { type: "activity", busy: [shared.conversationId] },
      {
        type: "activity",
        conversation: shared.conversationId,
        busy: true,
        approvals: 1,
        questions: 0,
      },
    ]);

    const owner = await readEvents(ownerToken, emit, `"conversation":"${shared.conversationId}"`);
    expect(owner).toEqual([
      { type: "activity", busy: [other.conversationId, shared.conversationId] },
      { type: "connection", id: "owner-mcp", status: "connected" },
      expect.objectContaining({ conversation: other.conversationId }),
      expect.objectContaining({ conversation: shared.conversationId }),
    ]);
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

    const chat = await until(async () => {
      const state = await rt.readChat(Number(bot.conversationId));
      return state.messages.some((m) => m.role === "user") ? state : undefined;
    }, "the guest's message");
    const mine = chat.messages.find((m) => m.role === "user");
    expect(mine).toMatchObject({
      text: "Can you fix the login test?",
      author: { id: guest.id, name: "Priya" },
    });

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
    expect((await asOwner("/api/v1/people/990001", { method: "DELETE" })).status).toBe(404);
  });

  it("adds a guest in one transaction: a failed guests row leaves no account to act as the owner (S8)", async () => {
    const person = { name: "Half", email: "half-made@example.com", password: "secret-pass" };
    db.run(
      sql.raw(
        "CREATE TEMP TRIGGER s8_refuse_guests BEFORE INSERT ON guests BEGIN SELECT RAISE(ABORT, 's8: guests row refused'); END",
      ),
    );
    try {
      const failed = await asOwner("/api/v1/people", { method: "POST", json: person });
      expect(failed.status).toBe(500);
    } finally {
      db.run(sql.raw("DROP TRIGGER IF EXISTS temp.s8_refuse_guests"));
    }
    expect(await db.$count(users, eq(users.email, person.email))).toBe(0);
    const login = await api<Data>(app, "/api/v1/auth/login", {
      method: "POST",
      json: { email: person.email, password: person.password },
    });
    expect(login.status).toBe(401);

    const added = await asOwner("/api/v1/people", { method: "POST", json: person });
    expect(added.status).toBe(201);
    made.push(added.body.data.id);
    const token = await authToken(person.email, added.body.data.id);
    expect((await api<Data>(app, "/api/v1/people/me", { token })).body.data).toEqual({
      guest: true,
    });
    const again = await asOwner("/api/v1/people", { method: "POST", json: person });
    expect(again.status).toBe(409);
    expect(await db.$count(users, eq(users.email, person.email))).toBe(1);
  });

  it("signs a removed guest out instead of treating them as the owner", async () => {
    const removed = await addGuest("Gone");
    const kept = await addGuest("Stays");
    made.push(kept.id);
    expect((await removed.asGuest("/api/v1/people/me")).body.data).toEqual({ guest: true });
    expect((await asOwner(`/api/v1/people/${removed.id}`, { method: "DELETE" })).status).toBe(200);

    const sock = { name: "Sock", email: "sock@example.com", password: "secret-pass" };
    for (const [method, path] of [
      ["GET", "/api/v1/people/me"],
      ["GET", "/api/v1/people"],
      ["GET", "/api/v1/vault"],
      ["POST", "/api/v1/people"],
      ["GET", "/api/v1/auth/me"],
    ] as const) {
      const response = await removed.asGuest(path, {
        method,
        json: method === "POST" ? sock : undefined,
      });
      expect(response.status, `${method} ${path}`).toBe(401);
      expect(response.body.error?.code, `${method} ${path}`).toBe("SESSION_INVALID");
    }
    expect(await db.$count(users, eq(users.email, sock.email))).toBe(0);

    expect((await asOwner("/api/v1/people/me")).body.data).toEqual({ guest: false });
    expect((await asOwner("/api/v1/vault")).status).toBe(200);
    expect((await kept.asGuest("/api/v1/people/me")).body.data).toEqual({ guest: true });
    expect((await kept.asGuest("/api/v1/people")).status).toBe(403);
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
    expect(matchGuestRoute("GET", "/uploads/u1/content")).toEqual({
      upload: { id: "u1", reach: "uploadedOrShared" },
    });
    expect(matchGuestRoute("DELETE", "/uploads/u1")).toEqual({
      upload: { id: "u1", reach: "uploaded" },
    });

    expect(matchGuestRoute("PATCH", "/bots/b1")).toBeUndefined();
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
        owner: async () => undefined,
      });
      const after = (await asOwner(`/api/v1/bots/${bot.id}`)).body.data;
      expect(after.lastMessagePreview).toBe(before.lastMessagePreview);
      expect(after.lastActivityAt).toBe(before.lastActivityAt);
    } finally {
      await closeAppRuntime();
    }
  });
});
