// Feature: past-chats (features/past-chats.md). Titles + counts in Chat history,
// the empty history page of the bot menu, opening from the sidebar row menu, Continue (footer and
// actions menu), Back to current chat, and Delete chat with its confirmation.
// New chat itself and the read-only view are proven by chats.mjs.
import { journey, expect } from "../scripts/lib.mjs";

await journey("past-chats", async ({ page, step, proof, cleanup, api, stamp }) => {
  const name = `Past Bot ${stamp}`;
  const composer = page.getByPlaceholder(`Message ${name}`);
  const first = `plan the trip ${stamp}`;
  const second = `and the hotels ${stamp}`;
  const third = `pack the bags ${stamp}`;
  const echo = (text) => page.getByText(`Echo: ${text}`).first();
  const items = page.getByTestId("past-chat-item");
  const pastChats = async () => (await api.get(`/bots/${botId}/chats`)).chats;
  let botId;

  const say = async (text) => {
    await composer.fill(text);
    await composer.press("Enter");
    await expect(echo(text)).toBeVisible({ timeout: 45_000 });
    // Idle again before the next action.
    await expect(page.getByRole("button", { name: "Send message" })).toBeVisible({
      timeout: 30_000,
    });
  };
  const newChat = async () => {
    await page.getByRole("button", { name: "Start a new chat" }).click();
    const confirm = page.getByRole("dialog", { name: "Start a new chat?" });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "New chat", exact: true }).click();
    await expect(confirm).toHaveCount(0);
  };

  await step("setup: a bot of its own via the API", async () => {
    const { defaultModelId: defaultModel } = await api.get("/models");
    botId = (await api.post("/bots", { name, modelId: defaultModel })).id;
    cleanup(async () => {
      await api.delete(`/bots/${botId}`);
      expect((await api.get("/bots")).some((b) => b.id === botId)).toBe(false);
    });
    await page.goto(`/chats/${botId}`);
    await expect(composer).toBeVisible({ timeout: 15_000 });
  });

  await step(
    "no past chats yet: the bot menu's history page says so, from the row menu too",
    async () => {
      await page.getByRole("button", { name: `${name} menu` }).click();
      await page.getByRole("menuitem", { name: "Chat history" }).click();
      await expect(
        page.getByText("No past chats yet. Starting a new chat keeps this one here."),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      const row = page
        .getByRole("region", { name: "Bots" })
        .locator("li")
        .filter({ hasText: name });
      await row.hover();
      await page.getByRole("button", { name: `${name} actions` }).click();
      await page.getByRole("menuitem", { name: "Chat history" }).click();
      await expect(
        page.getByText("No past chats yet. Starting a new chat keeps this one here."),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("menu")).toHaveCount(0);
    },
  );

  await step("chat, then New chat: the old chat is listed under its first message", async () => {
    await say(first);
    await newChat();
    await expect(page.getByText(`Echo: ${first}`)).toHaveCount(0);
    await page.getByRole("button", { name: `${name} menu` }).click();
    await page.getByRole("menuitem", { name: "Chat history" }).click();
    const item = items.filter({ hasText: first });
    await expect(item).toHaveCount(1);
    // Faux mode makes no title side-call: the title is the first owner message.
    await expect(item).toContainText("2 messages");
    const [row] = await pastChats();
    expect(row?.title).toBe(first);
    expect(row?.messageCount).toBe(2);
  });
  await proof("history-list");

  await step("open it: read-only view with title, Back to current chat returns", async () => {
    await items.filter({ hasText: first }).click();
    await expect(page).toHaveURL(/\/history\//);
    await expect(page.getByRole("heading", { name: new RegExp(first) })).toBeVisible();
    await expect(echo(first)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("past-chat-footer")).toContainText(`Past chat · ${first}`);
    await expect(composer).toHaveCount(0);
    await page.getByRole("button", { name: "Back to current chat" }).click();
    await expect(page).not.toHaveURL(/\/history\//);
    await expect(composer).toBeVisible();
  });

  await step("Continue this chat (footer): live again on the old conversation", async () => {
    await page.getByRole("button", { name: `${name} menu` }).click();
    await page.getByRole("menuitem", { name: "Chat history" }).click();
    await items.filter({ hasText: first }).click();
    await expect(page.getByTestId("past-chat-footer")).toBeVisible();
    await page
      .getByTestId("past-chat-footer")
      .getByRole("button", { name: "Continue this chat" })
      .click();
    await expect(page.getByText(/Chat continued/)).toBeVisible();
    await expect(page).not.toHaveURL(/\/history\//);
    await expect(echo(first)).toBeVisible({ timeout: 15_000 });
    await say(second);
    // The continued chat left the list; nothing was empty to record.
    expect(await pastChats()).toHaveLength(0);
  });
  await proof("continued");

  await step("a second New chat: the continued chat is listed again (4 messages)", async () => {
    await newChat();
    await say(third);
    await newChat();
    const chats = await pastChats();
    expect(chats.map((c) => c.title)).toEqual([third, first]);
    expect(chats.find((c) => c.title === first)?.messageCount).toBe(4);
  });

  await step("open from the sidebar row menu, Continue via Past chat actions", async () => {
    const row = page.getByRole("region", { name: "Bots" }).locator("li").filter({ hasText: name });
    await row.hover();
    await page.getByRole("button", { name: `${name} actions` }).click();
    await page.getByRole("menuitem", { name: "Chat history" }).click();
    // The bot menu opens itself on its history page.
    await expect(items).toHaveCount(2);
    await items.filter({ hasText: third }).click();
    await expect(echo(third)).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Past chat actions" }).click();
    await page.getByRole("menuitem", { name: "Continue this chat" }).click();
    await expect(page).not.toHaveURL(/\/history\//);
    await expect(echo(third)).toBeVisible({ timeout: 15_000 });
    // Continuing from an empty fresh chat records nothing new.
    expect((await pastChats()).map((c) => c.title)).toEqual([first]);
  });

  await step("delete a past chat through the confirmation", async () => {
    await page.getByRole("button", { name: `${name} menu` }).click();
    await page.getByRole("menuitem", { name: "Chat history" }).click();
    await items.filter({ hasText: first }).click();
    await expect(echo(second)).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Past chat actions" }).click();
    await page.getByRole("menuitem", { name: "Delete chat" }).click();
    const confirm = page
      .getByRole("alertdialog", { name: "Delete this chat?" })
      .or(page.getByRole("dialog", { name: "Delete this chat?" }));
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText(`"${first}" is removed from ${name}'s chat history`);
    await proof("delete-confirm");
    await confirm.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByText("Chat deleted")).toBeVisible();
    await expect(page).not.toHaveURL(/\/history\//);
    expect(await pastChats()).toHaveLength(0);
    // Nothing left to list: the bot menu's history page is empty again.
    await page.getByRole("button", { name: `${name} menu` }).click();
    await page.getByRole("menuitem", { name: "Chat history" }).click();
    await expect(page.getByText(/^No past chats yet/)).toBeVisible();
    await expect(items).toHaveCount(0);
  });
  await proof("deleted");
});
