// Feature: message-paging (features/message-paging.md). A 120-message conversation (60 faux
// exchanges, set up through the API) opens on its newest 60 messages; scrolling up in the UI
// loads the older pages with a cursor (GET /bots/:id/messages?before=…), first in the live chat,
// then in the same conversation as a past chat (GET /bots/:id/chats/:chatId/messages?before=…).
// Proves: nothing older is fetched on open, the oldest message appears only after scrolling,
// the pages are disjoint, and the transcript ends up complete, in order, without duplicates.
import { randomUUID } from "node:crypto";
import { journey, expect } from "../scripts/lib.mjs";

const EXCHANGES = 60; // 120 messages: a 60-message window plus pages of 50 and 10.
const WINDOW = 60; // CHAT_WINDOW (packages/agent/src/transcript.ts)
const PAGE = 50; // the client's page size (botsApi.history / pastChatHistory)

await journey("message-paging", async ({ page, step, proof, cleanup, api, stamp }) => {
  const name = `Paging Bot ${stamp}`;
  const text = (n) => `msg ${String(n).padStart(3, "0")} ${stamp}`;
  const expected = Array.from({ length: EXCHANGES }, (_, i) => text(i + 1));
  // The transcript's scroller region (the sidebar row also shows the latest echo as a preview).
  const transcript = page.getByRole("region", { name: "Messages" });
  const userBubbles = transcript.getByText(new RegExp(`^msg \\d{3} ${stamp}$`));
  const echoes = transcript.getByText(new RegExp(`^Echo: msg \\d{3} ${stamp}$`));
  const bubble = (n) => transcript.getByText(text(n), { exact: true });
  const echo = (n) => transcript.getByText(`Echo: ${text(n)}`, { exact: true });
  const older = transcript.getByTestId("older-messages");
  let botId;
  let chatId;

  // Every older-page request the page makes, with the page it got back.
  const pages = [];
  page.on("response", async (res) => {
    const url = new URL(res.url());
    if (res.request().method() !== "GET" || !url.searchParams.has("before")) return;
    if (!/\/api\/v1\/bots\/[^/]+(\/chats\/[^/]+)?\/messages$/.test(url.pathname)) return;
    const body = await res.json().catch(() => ({}));
    pages.push({
      path: url.pathname,
      before: url.searchParams.get("before"),
      limit: Number(url.searchParams.get("limit")),
      status: res.status(),
      ids: (body.data?.messages ?? []).map((m) => m.id),
      texts: (body.data?.messages ?? []).map((m) => m.text),
      hasMore: body.data?.hasMore,
    });
  });

  /** Wheel up over the transcript until `target` is on screen (each wheel arms the loader). */
  const scrollUpUntil = async (target) => {
    await bubble(EXCHANGES).hover();
    await expect(async () => {
      await page.mouse.wheel(0, -5000);
      await expect(target).toBeInViewport({ timeout: 1_000 });
    }).toPass({ timeout: 45_000 });
  };

  /** The rendered transcript: every exchange once, oldest first, each with its echo. */
  const expectCompleteTranscript = async () => {
    await expect(older).toHaveCount(0); // hasMore false: nothing left above
    expect(await userBubbles.allTextContents()).toEqual(expected);
    expect(await echoes.allTextContents()).toEqual(expected.map((t) => `Echo: ${t}`));
  };

  /** The cursor requests for `path`: chained, disjoint pages of the right size. */
  const expectCursorPages = (pathEnd) => {
    const mine = pages.filter((p) => p.path.endsWith(pathEnd));
    expect(mine.map((p) => p.status)).toEqual([200, 200]);
    expect(mine.map((p) => p.limit)).toEqual([PAGE, PAGE]);
    // Page 1: the 50 messages above the window (exchanges 6..30), more above.
    expect(mine[0].ids).toHaveLength(PAGE);
    expect(mine[0].hasMore).toBe(true);
    expect(mine[0].texts[0]).toBe(text(6));
    expect(mine[0].texts.at(-2)).toBe(text(30));
    // Page 2 is cursored on page 1's oldest message: the last 10 (exchanges 1..5), no more.
    expect(mine[1].before).toBe(mine[0].ids[0]);
    expect(mine[1].ids).toHaveLength(2 * EXCHANGES - WINDOW - PAGE);
    expect(mine[1].hasMore).toBe(false);
    expect(mine[1].texts[0]).toBe(text(1));
    const all = [...mine[1].ids, ...mine[0].ids];
    expect(new Set(all).size, "pages overlap").toBe(all.length);
    expect(mine[0].ids).not.toContain(mine[0].before);
  };

  await step(`setup: a bot with ${EXCHANGES} faux exchanges, sent through the API`, async () => {
    const { defaultModelId: defaultModel } = await api.get("/models");
    botId = (await api.post("/bots", { name, modelId: defaultModel })).id;
    cleanup(async () => {
      await api.delete(`/bots/${botId}`);
      expect((await api.get("/bots")).some((b) => b.id === botId)).toBe(false);
    });
    for (const t of expected) {
      await api.post(`/bots/${botId}/messages`, { requestId: randomUUID(), text: t });
      // Settled: idle again with this exchange's echo as the list preview.
      await expect
        .poll(
          async () => {
            const bot = (await api.get("/bots")).find((b) => b.id === botId);
            return !bot.replying && bot.lastMessagePreview === `Echo: ${t}`;
          },
          { timeout: 30_000, intervals: [150, 250, 400] },
        )
        .toBe(true);
    }
  });

  await step("open the chat: only the newest 60 messages, nothing older fetched", async () => {
    await page.goto(`/chats/${botId}`);
    await expect(echo(EXCHANGES)).toBeVisible({
      timeout: 15_000,
    });
    await expect(older).toBeVisible();
    await expect(older).toHaveText("Earlier messages");
    await expect(bubble(WINDOW / 2 + 1)).toBeAttached(); // first exchange in the window
    await expect(bubble(WINDOW / 2)).toHaveCount(0);
    await expect(bubble(1)).toHaveCount(0);
    expect(await userBubbles.count()).toBe(WINDOW / 2);
    // Opening (and the jump to the newest message) must not page anything in.
    await page.waitForTimeout(1_500);
    expect(pages, "no cursor request before the owner scrolls").toHaveLength(0);
  });
  await proof("live-window");

  await step("scroll up: two cursor pages load, the oldest message appears", async () => {
    await scrollUpUntil(bubble(1));
    await expect(echo(1)).toBeVisible();
    expectCursorPages(`/bots/${botId}/messages`);
  });
  await proof("live-oldest");

  await step("live transcript: 60 exchanges once each, oldest first", expectCompleteTranscript);

  await step("New chat: the long conversation becomes a 120-message past chat", async () => {
    await page.getByRole("button", { name: "Start a new chat" }).click();
    await expect(userBubbles).toHaveCount(0);
    const { chats } = await api.get(`/bots/${botId}/chats`);
    expect(chats).toHaveLength(1);
    expect(chats[0].title).toBe(text(1));
    expect(chats[0].messageCount).toBe(2 * EXCHANGES);
    chatId = chats[0].id;
  });

  await step("open it from Chat history: again only the newest 60 messages", async () => {
    pages.length = 0;
    await page.getByRole("button", { name: `${name} menu` }).click();
    await page.getByRole("menuitem", { name: "Chat history" }).click();
    const item = page.getByTestId("past-chat-item").filter({ hasText: text(1) });
    await expect(item).toContainText(`${2 * EXCHANGES} messages`);
    await item.click();
    await expect(page).toHaveURL(new RegExp(`/history/${chatId}$`));
    await expect(page.getByTestId("past-chat-footer")).toBeVisible();
    await expect(echo(EXCHANGES)).toBeVisible({
      timeout: 15_000,
    });
    await expect(older).toHaveText("Earlier messages");
    await expect(bubble(WINDOW / 2 + 1)).toBeAttached();
    await expect(bubble(WINDOW / 2)).toHaveCount(0);
    expect(await userBubbles.count()).toBe(WINDOW / 2);
    await page.waitForTimeout(1_500);
    expect(pages, "no cursor request before the owner scrolls").toHaveLength(0);
  });
  await proof("past-window");

  await step("scroll up in the past chat: its own cursor pages, the oldest message", async () => {
    await scrollUpUntil(bubble(1));
    expectCursorPages(`/bots/${botId}/chats/${chatId}/messages`);
    // The past chat pages from its own endpoint, never the live chat's.
    expect(pages.filter((p) => p.path === `/api/v1/bots/${botId}/messages`)).toHaveLength(0);
  });
  await proof("past-oldest");

  await step("past transcript: 60 exchanges once each, oldest first", expectCompleteTranscript);
});
