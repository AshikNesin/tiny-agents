// Feature: bot-builder (features/bot-builder.md). "/newbot NAME" makes the faux
// bot call create_bot: the approval card shows the whole new bot (short
// instructions included), Deny (no bot), Approve (the bot exists, opens and
// carries the proposed instructions), and the tool offers no Allow.
import { journey, expect } from "../scripts/lib.mjs";

await journey("bot-builder", async ({ page, step, proof, cleanup, api, stamp }) => {
  const name = `Builder Bot ${stamp}`;
  const child = `Built Bot ${stamp}`;
  const instructions = "You help the owner with the bot-builder e2e.";
  const composer = page.getByRole("textbox", { name: `Message ${name}` });
  const card = page.getByText(`${name} wants to create a new bot`);
  const dialog = page.getByRole("dialog", { name: `Edit ${name}` });
  const childOf = async () => (await api.get("/bots")).find((b) => b.name === child);
  let botId;

  const send = async (text) => {
    await composer.fill(text);
    await composer.press("Enter");
  };
  const settled = () =>
    expect(page.getByRole("button", { name: "Stop generating" })).toHaveCount(0, {
      timeout: 30_000,
    });

  await step("setup: create the faux bot that will ask", async () => {
    const bot = await api.post("/bots", { name, modelId: "test-model" });
    botId = bot.id;
    cleanup(async () => {
      await api.delete(`/bots/${botId}`);
      expect((await api.get("/bots")).some((b) => b.id === botId)).toBe(false);
    });
    cleanup(async () => {
      const made = await childOf();
      if (made) await api.delete(`/bots/${made.id}`);
    });
    await page.goto(`/chats/${botId}`);
    await expect(composer).toBeVisible({ timeout: 15_000 });
  });

  await step("Tools tab: Create a new bot offers only Ask (always) and Off", async () => {
    await page.getByRole("button", { name: `Edit ${name}` }).click();
    await dialog.getByRole("tab", { name: "Tools" }).click();
    const group = dialog.getByRole("radiogroup", { name: "Create a new bot permission" });
    await expect(group).toBeVisible({ timeout: 15_000 });
    await expect(group.getByRole("radio", { name: "Ask (always)" })).toHaveAttribute(
      "data-state",
      "on",
    );
    await expect(group.getByRole("radio", { name: "Allow" })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).not.toBeVisible();
  });

  await step(
    "/newbot shows the whole new bot on the card, short instructions included",
    async () => {
      await send(`/newbot ${child}`);
      await expect(card).toBeVisible({ timeout: 30_000 });
      await expect(card).toContainText(child);
      const pending = page.locator("[data-waiting]").filter({ has: card });
      await expect(pending.getByRole("definition")).toHaveText([
        "Made by the bot-builder e2e",
        "default model",
        instructions,
      ]);
      await expect(pending.getByRole("button", { name: "Read more" })).toHaveCount(0);
    },
  );
  await proof("card");

  await step("Deny: no bot is created", async () => {
    await page.getByRole("button", { name: "Deny", exact: true }).click();
    await expect(card).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByRole("button", { name: /^Created bot .* denied by you/ })).toBeVisible({
      timeout: 15_000,
    });
    await settled();
    expect(await childOf()).toBeUndefined();
  });
  await proof("denied");

  await step("Approve: the bot is created and the asking bot is told where", async () => {
    await send(`/newbot ${child}`);
    await expect(card).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(card).toHaveCount(0, { timeout: 15_000 });
    await settled();
    await expect.poll(childOf, { timeout: 15_000 }).toBeTruthy();
    const ran = page
      .getByRole("button", { name: new RegExp(`^Created bot “${child}”`) })
      .filter({ hasNotText: "denied" });
    await expect(ran).toHaveCount(1, { timeout: 15_000 });
    await ran.click();
    await expect(
      page.getByText(`The owner can open it at /chats/${(await childOf()).id}`),
    ).toBeVisible();
    await expect(
      page
        .getByRole("region", { name: "Bots" })
        .getByRole("link", { name: new RegExp(`^${child}`) }),
    ).toBeVisible({ timeout: 15_000 });
  });
  await proof("approved");

  await step("second view: the new bot opens with the proposed instructions", async () => {
    const made = await childOf();
    expect(made.modelId).toBe("test-model");
    await page.goto(`/chats/${made.id}`);
    await expect(page.getByRole("textbox", { name: `Message ${child}` })).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole("button", { name: `Edit ${child}` }).click();
    const editor = page.getByRole("dialog", { name: `Edit ${child}` });
    await expect(editor.getByLabel("System prompt")).toHaveValue(instructions);
  });
  await proof("created-editor");
});
