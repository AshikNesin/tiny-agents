/**
 * Bot-to-bot delivery (issue #12): mention routing in the bots service and
 * the relay that carries answers back into the asking conversation. Uses the
 * route-test runtime fake (no pi-durable) plus the real Prisma ledger.
 */
import express, { type Express } from "express";
import request from "supertest";
import { beforeEach, afterEach, describe, expect, it, vi } from "vite-plus/test";
import { prisma } from "@groot/core/database";
import { errorHandlerMiddleware } from "@groot/core/middlewares/error-handler.middleware";
import { generateToken } from "@groot/core/utils/jwt.utils";
import { registerRoutes } from "../../../apps/web/src/server/routes";
import { setAgentRuntimeForTests } from "../../../apps/web/src/server/api/bots/bots.runtime";
import { createBotRelay } from "../../../apps/web/src/server/api/bots/bots.relay";
import type { AgentRuntime } from "@tiny-agents/agent";

const token = generateToken({ userId: 1, email: "relay-test@example.com" });
const authorization = { Authorization: `Bearer ${token}` };

const emptyChat = { messages: [], busy: false };

function fakeRuntime(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    createConversation: vi.fn(),
    configure: vi.fn(),
    submit: vi.fn().mockResolvedValue(undefined),
    abort: vi.fn(),
    watchChat: vi.fn(async (_ref: number, listener: (events: unknown[]) => void) => {
      await listener([{ type: "snapshot", state: emptyChat }]);
      return { initial: emptyChat, stop: async () => undefined };
    }),
    isBusy: vi.fn().mockReturnValue(false),
    busyConversations: vi.fn().mockReturnValue([]),
    lastMessage: vi.fn().mockResolvedValue(undefined),
    onActivity: vi.fn().mockReturnValue(() => undefined),
    listModels: vi
      .fn()
      .mockReturnValue([
        { id: "m1", name: "M1", family: "other", reasoning: false, contextWindow: 8192 },
      ]),
    hasModel: vi.fn().mockReturnValue(true),
    listCapabilities: vi.fn().mockReturnValue([]),
    pendingApprovals: vi.fn().mockReturnValue(0),
    decideApproval: vi.fn(),
    installCapability: vi.fn(),
    ...overrides,
  } as unknown as AgentRuntime;
}

async function seedBot(name: string, conversationId: string) {
  return prisma.bot.create({
    data: { name, modelId: "m1", conversationId, toolkits: "[]" },
  });
}

describe("mention delivery", () => {
  let app: Express;
  let runtime: ReturnType<typeof fakeRuntime>;

  beforeEach(async () => {
    runtime = fakeRuntime();
    setAgentRuntimeForTests(runtime);
    app = express();
    app.use(express.json());
    registerRoutes(app);
    app.use(errorHandlerMiddleware);
    await prisma.botMessage.deleteMany();
    await prisma.bot.deleteMany();
  });

  afterEach(async () => {
    await prisma.botMessage.deleteMany();
    await prisma.bot.deleteMany();
  });

  it("delivers a copy to every mentioned bot and records the ledger row", async () => {
    const host = await seedBot("Host", "1");
    const guest = await seedBot("Guest", "2");
    const other = await seedBot("Other", "3");
    const res = await request(app)
      .post(`/api/v1/bots/${host.id}/messages`)
      .set(authorization)
      .send({
        requestId: "mention-req-0001",
        text: "@Guest and @Other, thoughts?",
        mentions: [guest.id, other.id],
      });
    expect(res.status).toBe(200);
    // Host gets the raw text; guests get an attributed copy.
    expect(runtime.submit).toHaveBeenCalledWith(1, {
      requestId: "mention-req-0001",
      text: "@Guest and @Other, thoughts?",
    });
    const guestText = vi.mocked(runtime.submit).mock.calls.find((c) => c[0] === 2)?.[1].text;
    expect(guestText).toContain("[From the owner, in Host's chat]");
    expect(guestText).toContain("@Guest and @Other, thoughts?");
    const rows = await prisma.botMessage.findMany({ orderBy: { toBotId: "asc" } });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.kind === "mention" && r.deliveredAt && !r.answeredAt)).toBe(true);
    expect(rows.every((r) => r.replyToBotId === host.id)).toBe(true);
  });

  it("is idempotent per requestId: a retried send never duplicates deliveries", async () => {
    const host = await seedBot("Host", "1");
    const guest = await seedBot("Guest", "2");
    const body = {
      requestId: "mention-req-0002",
      text: "@Guest hi",
      mentions: [guest.id],
    };
    await request(app).post(`/api/v1/bots/${host.id}/messages`).set(authorization).send(body);
    await request(app).post(`/api/v1/bots/${host.id}/messages`).set(authorization).send(body);
    expect(await prisma.botMessage.findMany({ where: { toBotId: guest.id } })).toHaveLength(1);
  });

  it("ignores mentions of the host itself and unknown ids", async () => {
    const host = await seedBot("Host", "1");
    const res = await request(app)
      .post(`/api/v1/bots/${host.id}/messages`)
      .set(authorization)
      .send({
        requestId: "mention-req-0003",
        text: "just me",
        mentions: [host.id, "does-not-exist"],
      });
    expect(res.status).toBe(200);
    expect(runtime.submit).toHaveBeenCalledTimes(1); // host only
    expect(await prisma.botMessage.findMany()).toHaveLength(0);
  });
});

describe("relay", () => {
  let runtime: ReturnType<typeof fakeRuntime>;

  beforeEach(async () => {
    runtime = fakeRuntime();
    await prisma.botMessage.deleteMany();
    await prisma.bot.deleteMany();
  });

  afterEach(async () => {
    await prisma.botMessage.deleteMany();
    await prisma.bot.deleteMany();
  });

  it("relays a finished reply back into the reply-to conversation and marks it answered", async () => {
    const host = await seedBot("Host", "1");
    const guest = await seedBot("Guest", "2");
    await prisma.botMessage.create({
      data: {
        fromBotId: null,
        toBotId: guest.id,
        replyToBotId: host.id,
        kind: "mention",
        requestId: "r1",
        text: "hello",
        deliveredAt: new Date(),
      },
    });
    const answered = Date.now();
    runtime.watchChat.mockImplementation(
      async (_ref: number, listener: (events: unknown[]) => Promise<void> | void) => {
        await listener([
          {
            type: "snapshot",
            state: {
              messages: [
                { id: "u1", role: "user", text: "hello", createdAt: answered - 2_000 },
                { id: "a1", role: "assistant", text: "Here is my answer", createdAt: answered },
              ],
              busy: false,
            },
          },
        ]);
        return { initial: { messages: [], busy: false }, stop: async () => undefined };
      },
    );
    const relay = createBotRelay(runtime);
    const relayed = await relay.relayForBot(guest.id);
    expect(relayed).toBe(1);
    expect(runtime.submit).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        requestId: expect.stringContaining("botmsg-reply-"),
        text: expect.stringContaining("**Reply from Guest:**"),
      }),
    );
    const row = await prisma.botMessage.findUnique({ where: { requestId: "r1" } });
    expect(row?.answeredAt).not.toBeNull();
    expect(row?.kind).toBe("relay");
    // Relaying again is a no-op (kind=relay never relays again).
    expect(await relay.relayForBot(guest.id)).toBe(0);
  });

  it("leaves deliveries pending while the target has no assistant reply yet", async () => {
    const host = await seedBot("Host", "1");
    const guest = await seedBot("Guest", "2");
    await prisma.botMessage.create({
      data: {
        fromBotId: null,
        toBotId: guest.id,
        replyToBotId: host.id,
        kind: "mention",
        requestId: "r2",
        text: "hello",
        deliveredAt: new Date(),
      },
    });
    runtime.lastMessage.mockResolvedValue(undefined);
    const relay = createBotRelay(runtime);
    expect(await relay.relayForBot(guest.id)).toBe(0);
    const row = await prisma.botMessage.findUnique({ where: { requestId: "r2" } });
    expect(row?.answeredAt).toBeNull();
  });

  it("never relays a stale reply that predates the delivery (boot sweep)", async () => {
    const host = await seedBot("Host", "1");
    const guest = await seedBot("Guest", "2");
    await prisma.botMessage.create({
      data: {
        fromBotId: null,
        toBotId: guest.id,
        replyToBotId: host.id,
        kind: "mention",
        requestId: "r3",
        text: "hello",
        deliveredAt: new Date(),
      },
    });
    // The guest's last reply predates the delivery: a restart sweep must
    // not present it as the answer.
    runtime.watchChat.mockImplementation(
      async (_ref: number, listener: (events: unknown[]) => Promise<void> | void) => {
        await listener([
          {
            type: "snapshot",
            state: {
              messages: [
                {
                  id: "old",
                  role: "assistant",
                  text: "Old reply before the mention",
                  createdAt: Date.now() - 60_000,
                },
              ],
              busy: false,
            },
          },
        ]);
        return { initial: { messages: [], busy: false }, stop: async () => undefined };
      },
    );
    const relay = createBotRelay(runtime);
    expect(await relay.relayForBot(guest.id)).toBe(0);
    const row = await prisma.botMessage.findUnique({ where: { requestId: "r3" } });
    expect(row?.answeredAt).toBeNull();
  });

  it("gives each of two queued deliveries its own reply, in order", async () => {
    const host = await seedBot("Host", "1");
    const guest = await seedBot("Guest", "2");
    const deliveredAt = new Date();
    for (const [requestId, text] of [
      ["first", "question one"],
      ["second", "question two"],
    ] as const) {
      await prisma.botMessage.create({
        data: {
          fromBotId: null,
          toBotId: guest.id,
          replyToBotId: host.id,
          kind: "mention",
          requestId,
          text,
          deliveredAt,
        },
      });
    }
    runtime.watchChat.mockImplementation(
      async (_ref: number, listener: (events: unknown[]) => Promise<void> | void) => {
        await listener([
          {
            type: "snapshot",
            state: {
              messages: [
                {
                  id: "a1",
                  role: "assistant",
                  text: "Answer to question one",
                  createdAt: deliveredAt.getTime() + 1_000,
                },
                {
                  id: "a2",
                  role: "assistant",
                  text: "Answer to question two",
                  createdAt: deliveredAt.getTime() + 2_000,
                },
              ],
              busy: false,
            },
          },
        ]);
        return { initial: { messages: [], busy: false }, stop: async () => undefined };
      },
    );
    const relay = createBotRelay(runtime);
    expect(await relay.relayForBot(guest.id)).toBe(2);
    const texts = runtime.submit.mock.calls.map((call: unknown[]) => call[1] as { text: string });
    expect(texts.map((t) => t.text)).toEqual([
      "**Reply from Guest:** Answer to question one",
      "**Reply from Guest:** Answer to question two",
    ]);
    for (const requestId of ["first", "second"]) {
      const row = await prisma.botMessage.findUnique({ where: { requestId } });
      expect(row?.answeredAt).not.toBeNull();
      expect(row?.answerReplyAt).not.toBeNull();
    }
  });
});
