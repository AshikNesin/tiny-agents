// Feature: bot-to-bot (features/bot-to-bot.md). @mention another bot from the
// composer (typed "@" or the + menu), the mentioned bot answers, its reply is
// relayed back into the host chat as a peer card, and the mentioned bot's own
// chat shows the owner's labeled message.
import { journey, expect } from "../scripts/lib.mjs";

await journey("bot-to-bot", async ({ page, step, proof, cleanup, api, stamp }) => {
  const peer = `Relay Peer ${stamp}`;
  const host = `Relay Host ${stamp}`;
  const composer = page.getByRole("textbox", { name: `Message ${host}` });
  const list = page.getByRole("listbox", { name: "Mention a bot" });
  const ids = {};

  await step("setup: create a peer bot and a host bot through the API", async () => {
    for (const name of [peer, host]) {
      const bot = await api.post("/bots", { name, modelId: "test-model" });
      ids[name] = bot.id;
      cleanup(async () => {
        await api.delete(`/bots/${bot.id}`);
        expect((await api.get("/bots")).some((b) => b.id === bot.id)).toBe(false);
      });
    }
    await page.goto(`/chats/${ids[host]}`);
    await expect(composer).toBeVisible({ timeout: 15_000 });
  });

  await step("with two bots the composer hints at @mentions", async () => {
    await expect(page.getByTestId("composer-hint")).toHaveText("Type @ to tag another bot");
  });
  await step("typing @ opens the mention list; a non-matching prefix closes it", async () => {
    // The query is the word after "@" (no spaces); the list filters by prefix.
    await composer.pressSequentially("@Relay");
    await expect(list.getByRole("option", { name: peer })).toBeVisible();
    // The host itself is never offered.
    await expect(list.getByRole("option", { name: host })).toHaveCount(0);
    await composer.pressSequentially("zz");
    await expect(list).toHaveCount(0);
  });
  await step("pick the bot from the list: the full @name lands in the composer", async () => {
    await composer.fill("");
    await composer.pressSequentially("what do you think @Relay");
    await list.getByRole("option", { name: peer }).click();
    await expect(list).toHaveCount(0);
    await expect(composer).toHaveValue(new RegExp(`^what do you think @${peer}\\s*$`));
  });
  await proof("mention-picked");

  await step("send: the owner's message shows in the host chat", async () => {
    await composer.press("End");
    await composer.pressSequentially(`ping ${stamp}`);
    await composer.press("Enter");
    await expect(page.getByText(`what do you think @${peer} ping ${stamp}`).first()).toBeVisible();
  });
  await step("the peer's reply is relayed back as a peer card", async () => {
    const card = page.getByTestId("peer-card").filter({ hasText: peer });
    await expect(card.first()).toBeVisible({ timeout: 45_000 });
    await expect(card.first()).toContainText("reply relayed into this chat");
    await expect(card.first()).toContainText(/Echo: \[From the owner/);
    await expect(card.first()).toContainText(`ping ${stamp}`);
    // Transcript plumbing never renders as the owner's bubble.
    await expect(
      page.locator('[data-slot="bubble"]').filter({ hasText: `Reply from ${peer}:` }),
    ).toHaveCount(0);
  });
  await proof("relayed");

  await step("second view: the peer's own chat shows the owner's labeled message", async () => {
    await page
      .getByRole("link", { name: new RegExp(`^${peer}`) })
      .first()
      .click();
    await expect(page.getByRole("button", { name: `${peer} menu` })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(`You · in ${host}'s chat`).first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(new RegExp(`ping ${stamp}`)).first()).toBeVisible();
    await expect(
      page.locator('[data-slot="bubble"]').filter({ hasText: "From the owner, in" }),
    ).toHaveCount(0);
  });
  await proof("peer-chat");

  // Last, so a failure here (see features/bot-to-bot.md Gotchas) leaves the relay proven above.
  await step("back to the host chat", async () => {
    await page.goto(`/chats/${ids[host]}`);
    await expect(composer).toBeVisible({ timeout: 15_000 });
  });
  await step("+ menu → Mention a bot opens the list; Enter picks the bot", async () => {
    await composer.fill("second thought ");
    await page.getByRole("button", { name: "Add files or mention a bot" }).click();
    await page.getByRole("menuitem", { name: /Mention a bot/ }).click();
    // The menu inserts "@" and must leave the caret in the composer with the list open.
    await expect(composer).toBeFocused();
    await expect(list.getByRole("option", { name: peer })).toBeVisible();
    await expect(list.getByRole("option", { name: peer })).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Enter");
    await expect(list).toHaveCount(0);
    await expect(composer).toHaveValue(new RegExp(`^second thought @${peer}\\s*$`));
  });
  await proof("menu-mention");
});
