// Feature: chats (features/chats.md). Create bot, streamed faux reply, a folded reply, Run again
// and Edit on the last message, the key list, Needs you in the sidebar, reload, new chat, history.
import { journey, expect } from "../scripts/lib.mjs";

await journey("chats", async ({ page, step, proof, cleanup, api, stamp }) => {
  const name = `Verify Bot ${stamp}`;
  const composer = page.getByPlaceholder(new RegExp(`(?:ask|message) ${name}`, "i"));
  let botId;

  await step("open New bot dialog and wait for the faux model", async () => {
    const empty = page.getByRole("button", { name: /create your first bot/i });
    if (await empty.isVisible()) await empty.click();
    else
      await page
        .getByRole("button", { name: /new bot/i })
        .first()
        .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("button", { name: "Test Model (faux)" })).toBeVisible({
      timeout: 15_000,
    });
  });
  await step("create the bot", async () => {
    await page.getByLabel("Name").fill(name);
    await page.getByRole("button", { name: /create bot/i }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("link", { name: new RegExp(name, "i") }).first()).toBeVisible();
    botId = (await api.get("/bots")).find((b) => b.name === name)?.id;
    expect(botId, "bot row exists in GET /bots").toBeTruthy();
    cleanup(async () => {
      await api.delete(`/bots/${botId}`);
      expect((await api.get("/bots")).some((b) => b.id === botId)).toBe(false);
    });
  });
  await step("send a message and get the streamed echo", async () => {
    await composer.fill(`hello ${stamp}`);
    await composer.press("Enter");
    await expect(page.getByText(`hello ${stamp}`).first()).toBeVisible();
    await expect(page.getByText(new RegExp(`Echo: hello ${stamp}`, "i")).first()).toBeVisible({
      timeout: 30_000,
    });
  });
  await proof("reply");
  const blur = () => page.evaluate(() => document.activeElement?.blur());
  const transcriptText = () => page.locator("main").innerText();
  await step("a finished reply's tool calls and reasoning fold into one Worked line", async () => {
    await composer.fill("/trace");
    await composer.press("Enter");
    const work = page.getByTestId("reply-work").last();
    await expect(work).toContainText("Worked:", { timeout: 30_000 });
    await expect(page.getByText("Let me look at your open tasks first.").first()).toBeVisible();
    await expect(page.getByText("Here is where things stand:").first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole("button", { name: "Run this again" })).toHaveCount(1, {
      timeout: 20_000,
    });
  });
  await proof("folded");
  await step(
    "t runs the last message again from before it; the chat as it was becomes a past chat",
    async () => {
      await blur();
      await page.keyboard.press("t");
      await expect
        .poll(async () => (await api.get(`/bots/${botId}/chats`)).chats.length, { timeout: 20_000 })
        .toBe(1);
      await expect(page.getByText("Here is where things stand:").first()).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByRole("button", { name: "Run this again" })).toHaveCount(1, {
        timeout: 20_000,
      });
      expect((await transcriptText()).match(/\/trace/g)?.length ?? 0).toBe(1);
    },
  );
  await step(
    "e puts the last message in the composer, and sending goes back to before it",
    async () => {
      await expect(page.getByRole("button", { name: "Edit this message" })).toHaveCount(1, {
        timeout: 20_000,
      });
      await blur();
      await page.keyboard.press("e");
      await expect(composer).toHaveValue("/trace");
      await expect(page.getByTestId("editing-banner")).toBeVisible();
      await composer.fill(`edited ${stamp}`);
      await composer.press("Enter");
      await expect(page.getByText(new RegExp(`Echo: edited ${stamp}`)).first()).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByTestId("editing-banner")).toHaveCount(0);
      expect(await transcriptText()).not.toContain("/trace");
    },
  );
  await proof("edited");
  await step("? lists the chat's keys", async () => {
    await blur();
    await page.keyboard.press("?");
    const keys = page.getByTestId("code-keys");
    await expect(keys).toContainText("Next bot that needs you");
    await expect(keys).toContainText("Edit your last message");
    await page.keyboard.press("Escape");
  });
  await step("a bot asking you a question moves under Needs you in the sidebar", async () => {
    await composer.fill(`/ask ${stamp}`);
    await composer.press("Enter");
    const needs = page.getByRole("list", { name: "Needs you" });
    await expect(needs.getByRole("link", { name: new RegExp(name) })).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole("button", { name: "Dismiss" }).first().click();
    await expect(page.getByRole("list", { name: "Needs you" })).toHaveCount(0, { timeout: 20_000 });
  });
  await proof("sidebar");
  await step("reload keeps the transcript", async () => {
    await page.reload();
    await expect(page.getByText(new RegExp(`Echo: hello ${stamp}`, "i")).first()).toBeVisible({
      timeout: 15_000,
    });
  });
  await step("New chat clears the transcript", async () => {
    await page.getByRole("button", { name: "Start a new chat" }).click();
    await page.getByRole("button", { name: "New chat", exact: true }).click();
    await expect(page.getByText(new RegExp(`Echo: hello ${stamp}`, "i"))).toHaveCount(0);
  });
  await step("old chat is readable from Chat history", async () => {
    await page.getByRole("button", { name: "Past chats" }).click();
    await page
      .getByTestId("past-chat-item")
      .filter({ hasText: `hello ${stamp}` })
      .first()
      .click();
    await expect(page).toHaveURL(/\/history\//);
    await expect(page.getByText(new RegExp(`Echo: hello ${stamp}`, "i")).first()).toBeVisible();
    await expect(page.getByTestId("past-chat-footer")).toBeVisible();
  });
  await proof("history");
});
