// Feature: chats (features/chats.md). Create bot, streamed faux reply, reload, new chat, history.
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
    await page.getByRole("button", { name: `${name} menu` }).click();
    await page.getByRole("menuitem", { name: "Chat history" }).click();
    await page
      .getByTestId("past-chat-item")
      .filter({ hasText: `hello ${stamp}` })
      .click();
    await expect(page).toHaveURL(/\/history\//);
    await expect(page.getByText(new RegExp(`Echo: hello ${stamp}`, "i")).first()).toBeVisible();
    await expect(page.getByTestId("past-chat-footer")).toBeVisible();
  });
  await proof("history");
});
