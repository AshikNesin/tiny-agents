import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import type { AgentRuntime } from "../../../packages/agent/src/index";
import { app as appRoot } from "../../../apps/web/src/server/app-root";
import { db, botGuests, bots, guests, uploads } from "../../../apps/web/src/server/db";
import { isBotWatched } from "../../../apps/web/src/server/api/bots/bots.viewers";
import { api, createTestApp } from "../helpers";
import {
  authToken,
  closeAppRuntime,
  openAppRuntime,
  resetAppTables,
  seedBot,
  spyOnRuntime,
  TEST_MODEL,
  type SpiedRuntime,
} from "../fixtures";

const OWNER_ID = 990_701;
const GUEST_ID = 990_702;
const ownerToken = await authToken("access-owner@example.com", OWNER_ID);
const guestToken = await authToken("access-guest@example.com", GUEST_ID);

const app = createTestApp();

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- response data varies per route
type Data = any;

type Init = { method?: string; json?: unknown };
const asOwner = (path: string, init: Init = {}) =>
  api<Data>(app, path, { ...init, token: ownerToken });
const asGuest = (path: string, init: Init = {}) =>
  api<Data>(app, path, { ...init, token: guestToken });

const refused = (code: string, message: string) => ({
  success: false,
  error: expect.objectContaining({ code, message }),
});
const forbidden = refused("FORBIDDEN", "Only the owner can do that");
const botNotFound = refused("NOT_FOUND", "Bot not found");

const share = (botId: string) => db.insert(botGuests).values({ botId, userId: GUEST_ID });

let uploadSeq = 0;

async function seedUpload(uploadedBy: number, botId: string | null): Promise<string> {
  uploadSeq += 1;
  const [row] = await db
    .insert(uploads)
    .values({
      id: uploadSeq.toString(16).padStart(24, "a"),
      kind: "image",
      name: "pic.png",
      mimeType: "image/png",
      size: 10,
      width: 1,
      height: 1,
      storageKey: `chat/access/${uploadSeq}`,
      uploadedBy,
      botId,
    })
    .returning();
  return row!.id;
}

let rt: AgentRuntime;
let spied: SpiedRuntime;

beforeEach(async () => {
  rt = await openAppRuntime();
  spied = spyOnRuntime(rt);
  await resetAppTables();
  await db.insert(guests).values({ userId: GUEST_ID });
});

afterEach(async () => {
  await resetAppTables();
  await closeAppRuntime();
});

describe("the guard: table, then the bot's share, then the upload", () => {
  it("refuses a guest anything the table does not list with 403, before any 404", async () => {
    const shared = await seedBot();
    await share(shared.id);
    for (const [method, path] of [
      ["GET", "/api/v1/notifications"],
      ["GET", "/api/v1/jobs"],
      ["GET", "/api/v1/no-such-route"],
      ["DELETE", "/api/v1/people/me"],
      ["GET", "/api/v1/bots/no-such-bot/chats"],
      ["PATCH", "/api/v1/bots/no-such-bot"],
      ["GET", `/api/v1/bots/${shared.id}/no-such-route`],
      ["GET", "/api/v1/uploads/no-such-upload/no-such-route"],
    ] as const) {
      expect((await asGuest(path, { method })).body, `${method} ${path}`).toEqual(forbidden);
    }
    expect((await asOwner("/api/v1/no-such-route")).status).toBe(404);
  });

  it("answers 404 'Bot not found' for an unshared or unknown bot before the route reads anything", async () => {
    const other = await seedBot();
    for (const id of [other.id, "no-such-bot"]) {
      const sent = await asGuest(`/api/v1/bots/${id}/messages`, { method: "POST", json: {} });
      expect(sent.body, id).toEqual(botNotFound);
      const approval = await asGuest(`/api/v1/bots/${id}/approvals/0`, {
        method: "POST",
        json: {},
      });
      expect(approval.body, id).toEqual(botNotFound);
      const malformed = await asGuest(`/api/v1/bots/${id}/approvals/x`, { method: "POST" });
      expect(malformed.body, id).toEqual(forbidden);
    }
    expect(
      (await asOwner("/api/v1/bots/no-such-bot/messages", { method: "POST", json: {} })).status,
    ).toBe(400);
    expect(spied.submit).not.toHaveBeenCalled();
  });

  it("answers 404 'Unknown upload' for an upload the guest does not reach, before the route's checks", async () => {
    const shared = await seedBot();
    await share(shared.id);
    const other = await seedBot();
    const ownerPrivate = await seedUpload(OWNER_ID, other.id);
    const ownerInShared = await seedUpload(OWNER_ID, shared.id);
    const unknown = refused("NOT_FOUND", "Unknown upload");
    expect((await asGuest("/api/v1/uploads/not-hex")).body).toEqual(unknown);
    expect((await asOwner("/api/v1/uploads/not-hex")).body).toEqual(
      refused("BAD_REQUEST", "Invalid upload id"),
    );
    expect((await asGuest(`/api/v1/uploads/${ownerPrivate}`)).body).toEqual(unknown);
    expect((await asGuest(`/api/v1/uploads/${ownerPrivate}/text`)).body).toEqual(unknown);
    expect((await asGuest(`/api/v1/uploads/${ownerInShared}`)).status).toBe(200);
    expect((await asGuest(`/api/v1/uploads/${ownerInShared}`, { method: "DELETE" })).body).toEqual(
      unknown,
    );
  });
});

describe("a guest's send: attachments after the body, before the send", () => {
  it("names the first attachment the guest does not reach, in the order sent", async () => {
    const shared = await seedBot();
    await share(shared.id);
    const other = await seedBot();
    const mine = await seedUpload(GUEST_ID, null);
    const first = await seedUpload(OWNER_ID, other.id);
    const second = await seedUpload(OWNER_ID, null);
    const send = (attachments: string[], json: Record<string, unknown> = {}) =>
      asGuest(`/api/v1/bots/${shared.id}/messages`, {
        method: "POST",
        json: { requestId: "guest-access-0001", text: "see", attachments, ...json },
      });

    expect((await send([mine, first, second])).body).toEqual(
      refused("NOT_FOUND", `Unknown attachment "${first}"`),
    );
    expect((await send([mine, second, first])).body).toEqual(
      refused("NOT_FOUND", `Unknown attachment "${second}"`),
    );
    expect((await send([first], { requestId: "x" })).status).toBe(400);
    expect(spied.submit).not.toHaveBeenCalled();
  });
});

describe("a guest's approval answers (decideApproval)", () => {
  const waitingCard = (name: string, extra: Record<string, unknown> = {}) =>
    spied.readChat.mockResolvedValueOnce({
      messages: [
        {
          id: "e1",
          role: "assistant",
          text: "",
          status: "streaming",
          createdAt: 0,
          toolCalls: [{ id: "t1", name, status: "awaiting_approval", taskId: 7, ...extra }],
        },
      ],
      busy: true,
      queued: [],
    } as never);

  let botId: string;
  const decide = (json: Record<string, unknown>, as = asGuest, task = "7") =>
    as(`/api/v1/bots/${botId}/approvals/${task}`, { method: "POST", json });

  beforeEach(async () => {
    botId = (await seedBot()).id;
    await share(botId);
  });

  it("refuses 'always allow' and a grant with 403 before S5's mismatch and the 409", async () => {
    waitingCard("send_email");
    expect((await decide({ decision: "approved", alwaysAllow: "run_command" })).body).toEqual(
      forbidden,
    );
    expect((await decide({ decision: "approved", alwaysAllow: "send_email" })).body).toEqual(
      forbidden,
    );
    expect((await decide({ decision: "denied", grant: true })).body).toEqual(forbidden);
    expect(spied.decideApproval).not.toHaveBeenCalled();
    waitingCard("send_email");
    expect(
      (await decide({ decision: "approved", alwaysAllow: "run_command" }, asOwner)).body,
    ).toEqual(
      refused(
        "ALWAYS_ALLOW_MISMATCH",
        '"Always allow" must name the tool being approved (send_email)',
      ),
    );
  });

  it("refuses a guest any answer on a save_skill card", async () => {
    for (const decision of ["approved", "denied"]) {
      waitingCard("save_skill");
      expect((await decide({ decision })).body, decision).toEqual(
        refused("FORBIDDEN", "Only the owner can approve saving skills"),
      );
    }
    expect(spied.decideApproval).not.toHaveBeenCalled();
  });

  it("refuses a guest any answer on a vault card, approving or denying", async () => {
    for (const decision of ["approved", "denied"]) {
      waitingCard("browser_fill_secret", { vault: { handle: "bank", kind: "login" } });
      expect((await decide({ decision })).body, decision).toEqual(
        refused("FORBIDDEN", "Only the owner can approve vault use"),
      );
    }
    expect(spied.decideApproval).not.toHaveBeenCalled();
  });

  it("lets a guest answer any other card, and validates the request before checking", async () => {
    waitingCard("send_email");
    spied.decideApproval.mockResolvedValueOnce(undefined);
    expect((await decide({ decision: "approved" })).body).toEqual({
      success: true,
      data: { decided: "approved" },
    });
    expect(spied.decideApproval).toHaveBeenCalledWith(Number(await conv(botId)), 7, "approved");
    expect((await decide({ decision: "denied" })).status).toBe(409);
    expect((await decide({ decision: "approved", alwaysAllow: "x" }, asGuest, "0")).body).toEqual(
      refused("BAD_REQUEST", "Invalid taskId"),
    );
    expect((await decide({ decision: "maybe", grant: true })).status).toBe(400);
  });
});

async function conv(botId: string): Promise<string> {
  const row = await db.query.bots.findFirst({ where: eq(bots.id, botId) });
  return row!.conversationId;
}

describe("read markers: the owner's on the bot row, a guest's on their share", () => {
  const marker = async (botId: string) =>
    (
      await db.query.botGuests.findFirst({
        where: and(eq(botGuests.botId, botId), eq(botGuests.userId, GUEST_ID)),
      })
    )?.lastReadAt ?? null;
  const ownerMarker = async (botId: string) =>
    (await db.query.bots.findFirst({ where: eq(bots.id, botId) }))!.lastReadAt;

  it("marks only the reader's own marker and answers with the owner's bot row", async () => {
    const bot = await seedBot();
    await share(bot.id);
    const read = await asGuest(`/api/v1/bots/${bot.id}/read`, { method: "POST" });
    expect(read.status).toBe(200);
    expect(read.body.data.lastReadAt).toBeNull();
    expect(await marker(bot.id)).not.toBeNull();
    expect(await ownerMarker(bot.id)).toBeNull();

    await db.update(botGuests).set({ lastReadAt: null });
    const owner = await asOwner(`/api/v1/bots/${bot.id}/read`, { method: "POST" });
    expect(owner.body.data.lastReadAt).not.toBeNull();
    expect(await marker(bot.id)).toBeNull();
  });

  it("lists a guest's shared bots read against their own marker", async () => {
    const bot = await seedBot();
    await seedBot();
    await share(bot.id);
    await db
      .update(bots)
      .set({
        lastMessagePreview: "hi",
        lastActivityAt: new Date("2026-11-06T07:00:00.000Z"),
        lastReadAt: new Date("2026-11-06T08:00:00.000Z"),
      })
      .where(eq(bots.id, bot.id));
    const guestList = (await asGuest("/api/v1/bots")).body.data;
    expect(guestList).toEqual([
      expect.objectContaining({ id: bot.id, lastReadAt: null, unread: true }),
    ]);
    await db.update(botGuests).set({ lastReadAt: new Date("2026-11-06T09:00:00.000Z") });
    expect((await asGuest("/api/v1/bots")).body.data).toEqual([
      expect.objectContaining({ lastReadAt: "2026-11-06T09:00:00.000Z", unread: false }),
    ]);
    expect((await asOwner("/api/v1/bots")).body.data).toHaveLength(2);
  });
});

describe("live follows", () => {
  type ActivityChange = Parameters<Parameters<AgentRuntime["onActivity"]>[0]>[0];

  async function readSse(
    path: string,
    token: string,
    onFirstEvent: () => void,
    until: string,
  ): Promise<Array<{ type: string }>> {
    const response = await app.request(path, { headers: { authorization: `Bearer ${token}` } });
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

  it("filters a guest's events by the shares as they are at each event, not when it opened", async () => {
    const before = await seedBot();
    const after = await seedBot();
    await share(before.id);
    const activity = new Set<(change: ActivityChange) => void>();
    spied.onActivity.mockImplementation((listener) => {
      activity.add(listener);
      return () => activity.delete(listener);
    });
    spied.busyConversations.mockReturnValue([
      Number(before.conversationId),
      Number(after.conversationId),
    ]);
    const emit = (conversation: string) => {
      for (const listener of activity) {
        listener({ conversation: Number(conversation), busy: true, approvals: 0, questions: 0 });
      }
    };
    const seen = await readSse(
      "/api/v1/events",
      guestToken,
      () => {
        db.insert(botGuests).values({ botId: after.id, userId: GUEST_ID }).run();
        db.delete(botGuests).where(eq(botGuests.botId, before.id)).run();
        emit(before.conversationId);
        emit(after.conversationId);
      },
      `"conversation":"${after.conversationId}"`,
    );
    expect(seen).toEqual([
      { type: "activity", busy: [before.conversationId] },
      {
        type: "activity",
        conversation: after.conversationId,
        busy: true,
        approvals: 0,
        questions: 0,
      },
    ]);
  });

  it("sends a guest model changes too", async () => {
    const seen = await readSse(
      "/api/v1/events",
      guestToken,
      () => {
        for (const listener of appRoot().modelListeners) listener();
      },
      "models.changed",
    );
    expect(seen.map((event) => event.type)).toEqual(["activity", "models.changed"]);
  });

  it("counts only the owner's open chat as watched (S2)", async () => {
    const bot = await seedBot();
    await share(bot.id);
    let watched: boolean | undefined;
    await readSse(
      `/api/v1/bots/${bot.id}/stream`,
      guestToken,
      () => (watched = isBotWatched(bot.id)),
      "data:",
    );
    expect(watched).toBe(false);
    await readSse(
      `/api/v1/bots/${bot.id}/stream`,
      ownerToken,
      () => (watched = isBotWatched(bot.id)),
      "data:",
    );
    expect(watched).toBe(true);
  });
});

describe("people: who can be removed or shared with", () => {
  it("removes only guests, with 404 'Guest not found' for the owner or anyone unknown", async () => {
    const notFound = refused("NOT_FOUND", "Guest not found");
    expect((await asOwner(`/api/v1/people/${OWNER_ID}`, { method: "DELETE" })).body).toEqual(
      notFound,
    );
    expect((await asOwner("/api/v1/people/12345678", { method: "DELETE" })).body).toEqual(notFound);
    expect((await asOwner("/api/v1/people/abc", { method: "DELETE" })).body).toEqual(
      refused("BAD_REQUEST", "Invalid userId format"),
    );
  });

  it("refuses sharing with a non-guest with 400 'Unknown guest', after the name check", async () => {
    const bot = await seedBot({ name: "Taken" });
    const other = await seedBot({ name: "Mine" });
    const patch = (json: Record<string, unknown>) =>
      asOwner(`/api/v1/bots/${other.id}`, { method: "PATCH", json });
    expect((await patch({ guestIds: [OWNER_ID] })).body).toEqual(
      refused("BAD_REQUEST", "Unknown guest"),
    );
    expect((await patch({ name: bot.name, guestIds: [OWNER_ID] })).status).toBe(409);
    const created = await asOwner("/api/v1/bots", {
      method: "POST",
      json: { name: "Half made", modelId: TEST_MODEL, systemPrompt: "x", guestIds: [OWNER_ID] },
    });
    expect(created.body).toEqual(refused("BAD_REQUEST", "Unknown guest"));
    expect(await db.$count(bots, eq(bots.name, "Half made"))).toBe(1);
  });
});
