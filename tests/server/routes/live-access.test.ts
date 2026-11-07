/**
 * Taking access away takes it away live: removing a guest, or unsharing a
 * bot from them, ends the streams, desktop viewers and unredeemed tickets
 * they already hold, not only their next request.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Duplex } from "node:stream";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { db, users } from "../../../apps/web/src/server/db";
import {
  attachBrowserVnc,
  issueVncTicket,
  redeemVncTicket,
  resetVncTicketsForTests,
} from "../../../apps/web/src/server/api/bots/browser.vnc";
import { setBrowserSessionsForTests } from "../../../apps/web/src/server/api/bots/browser.sessions";
import {
  createBrowserSessions,
  type BrowserSession,
  type BrowserSessions,
} from "../../../packages/agent/src/toolkits/browser";
import { api, createTestApp } from "../helpers";
import {
  authToken,
  closeAppRuntime,
  openAppRuntime,
  resetAppTables,
  TEST_MODEL,
  until,
} from "../fixtures";

const app = createTestApp();
const ownerToken = await authToken("live-access-owner@example.com", 990_101);

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- response data varies per route
type Data = any;

const asOwner = (path: string, init: { method?: string; json?: unknown } = {}) =>
  api<Data>(app, path, { ...init, token: ownerToken });

let seq = 0;

async function addGuest() {
  seq += 1;
  const email = `live-guest-${seq}-${Date.now()}@example.com`;
  const added = await asOwner("/api/v1/people", {
    method: "POST",
    json: { name: "Priya", email, password: "secret-pass" },
  });
  expect(added.status).toBe(201);
  const id: number = added.body.data.id;
  return { id, token: await authToken(email, id) };
}

async function createBot(name: string, guestIds: number[]) {
  const created = await asOwner("/api/v1/bots", {
    method: "POST",
    json: { name, modelId: TEST_MODEL, systemPrompt: "Be brief.", guestIds },
  });
  expect(created.status).toBe(201);
  return created.body.data.id as string;
}

/** An SSE response the guest holds open; `ended` settles when the server ends it. */
async function openStream(path: string, token: string) {
  const response = await app.request(path, { headers: { authorization: `Bearer ${token}` } });
  expect(response.status, path).toBe(200);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let isEnded = false;
  const ended = (async () => {
    for (;;) {
      const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true }));
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    isEnded = true;
  })();
  await until(() => text.includes("data:"), `the first event of ${path}`);
  return {
    ended,
    get isEnded() {
      return isEnded;
    },
    close: () => reader.cancel().catch(() => undefined),
  };
}

const ENDS_WITHIN_MS = 1_000;

async function endsSoon(ended: Promise<unknown>, what: string) {
  const late = Symbol("late");
  const result = await Promise.race([
    ended,
    new Promise((resolve) => setTimeout(() => resolve(late), ENDS_WITHIN_MS)),
  ]);
  expect(result, `${what} ended within ${ENDS_WITHIN_MS} ms`).not.toBe(late);
}

let sessions: BrowserSessions | undefined;

function session(openStream: () => Promise<Duplex>): BrowserSession {
  return {
    vnc: { scale: 1, openStream, resize: async () => {} },
    url: () => "about:blank",
    navigate: async () => ({ url: "about:blank", status: 200 }),
    snapshot: async () => "",
    click: async () => ({ url: "about:blank" }),
    type: async () => ({ url: "about:blank" }),
    press: async () => {},
    scroll: async () => {},
    screenshot: async () => ({ data: "" }),
    close: async () => {},
  };
}

/** A live browser for `bot` whose RFB side greets every viewer. */
async function liveBrowser(bot: string) {
  const target = { profile: "shared", tab: bot };
  sessions = createBrowserSessions({
    transport: async () =>
      session(async () => {
        const vm = new Duplex({ read() {}, write: (_c, _e, done) => done() });
        vm.push(Buffer.from("RFB 003.008\n"));
        return vm;
      }),
    profilesDir: "/tmp/ta-live-access-profiles",
  });
  setBrowserSessionsForTests(sessions);
  await sessions.acquire(target);
  return target;
}

describe("revoking a guest's access", () => {
  const made: number[] = [];
  let server: Server;
  let port: number;
  let bridge: { close(): void };
  const sockets: WebSocket[] = [];
  const streams: { close(): unknown }[] = [];

  beforeEach(async () => {
    await openAppRuntime();
    await resetAppTables();
    resetVncTicketsForTests();
    server = createServer();
    bridge = attachBrowserVnc(server);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    for (const stream of streams.splice(0)) await stream.close();
    for (const ws of sockets.splice(0)) ws.close();
    bridge.close();
    await new Promise((resolve) => server.close(resolve));
    await sessions?.closeAll();
    setBrowserSessionsForTests(undefined);
    for (const id of made.splice(0)) await db.delete(users).where(eq(users.id, id));
    await closeAppRuntime();
  });

  /** A desktop viewer the guest holds open on `bot`; `closed` settles when the server drops it. */
  async function openViewer(userId: number, bot: string, target: { profile: string; tab: string }) {
    const ticket = issueVncTicket({ userId, botId: bot, target });
    const ws = new WebSocket(
      `ws://localhost:${port}/api/v1/bots/${bot}/browser/vnc?ticket=${ticket}`,
    );
    sockets.push(ws);
    const closed = new Promise<void>((resolve) =>
      ws.addEventListener("close", () => resolve(), { once: true }),
    );
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("message", () => resolve(), { once: true });
      ws.addEventListener("error", () => reject(new Error("viewer failed to open")), {
        once: true,
      });
    });
    return { closed };
  }

  it("ends everything a removed guest holds open, and refuses their minted tickets", async () => {
    const guest = await addGuest();
    const bot = await createBot("Shared helper", [guest.id]);
    const target = await liveBrowser(bot);

    const chat = await openStream(`/api/v1/bots/${bot}/stream`, guest.token);
    const events = await openStream("/api/v1/events", guest.token);
    streams.push(chat, events);
    const viewer = await openViewer(guest.id, bot, target);
    const pending = issueVncTicket({ userId: guest.id, botId: bot, target });

    expect((await asOwner(`/api/v1/people/${guest.id}`, { method: "DELETE" })).status).toBe(200);

    await endsSoon(chat.ended, "the chat stream");
    await endsSoon(events.ended, "the events stream");
    await endsSoon(viewer.closed, "the desktop viewer");
    expect(redeemVncTicket(pending, bot)).toBeUndefined();
  });

  it("ends a guest's streams and viewers of a bot unshared from them, and nothing else", async () => {
    const guest = await addGuest();
    made.push(guest.id);
    const unshared = await createBot("Leaving helper", [guest.id]);
    const kept = await createBot("Staying helper", [guest.id]);
    const target = await liveBrowser(unshared);

    const chat = await openStream(`/api/v1/bots/${unshared}/stream`, guest.token);
    const keptChat = await openStream(`/api/v1/bots/${kept}/stream`, guest.token);
    const events = await openStream("/api/v1/events", guest.token);
    streams.push(chat, keptChat, events);
    const viewer = await openViewer(guest.id, unshared, target);
    const pending = issueVncTicket({ userId: guest.id, botId: unshared, target });
    const keptTicket = issueVncTicket({ userId: guest.id, botId: kept, target });

    const patched = await asOwner(`/api/v1/bots/${unshared}`, {
      method: "PATCH",
      json: { guestIds: [] },
    });
    expect(patched.status).toBe(200);

    await endsSoon(chat.ended, "the unshared bot's chat stream");
    await endsSoon(viewer.closed, "the unshared bot's desktop viewer");
    expect(redeemVncTicket(pending, unshared)).toBeUndefined();

    expect(keptChat.isEnded, "the still-shared bot's stream").toBe(false);
    expect(events.isEnded, "the guest's events stream").toBe(false);
    expect(redeemVncTicket(keptTicket, kept)).toMatchObject({ userId: guest.id, botId: kept });
  });
});
