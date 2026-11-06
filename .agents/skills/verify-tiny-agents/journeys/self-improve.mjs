// Feature: self-improve (features/self-improve.md). "/improve" makes the faux
// bot call update_instructions: the approval card, Deny (no change), Approve
// (instructions really change, seen in Edit bot), Always allow still asks
// next time (Ask always), "/improve long" folds behind Read more.
import { journey, expect } from "../scripts/lib.mjs";

await journey("self-improve", async ({ page, step, proof, cleanup, api, stamp }) => {
  const name = `Improve Bot ${stamp}`;
  const base = `Base prompt ${stamp}.`;
  const line = "Self-improvement e2e: append this line.";
  const longHead = "Self-improvement e2e: a deliberately long change";
  const longTail = "This line exists only to push the payload over the fold threshold.";
  const composer = page.getByRole("textbox", { name: `Message ${name}` });
  const card = page.getByText(`${name} wants to update own instructions`);
  const dialog = page.getByRole("dialog", { name: `Edit ${name}` });
  let botId;

  const send = async (text) => {
    await composer.fill(text);
    await composer.press("Enter");
  };
  const prompt = async () => (await api.get(`/bots/${botId}`)).systemPrompt;
  const settled = () =>
    expect(page.getByRole("button", { name: "Stop generating" })).toHaveCount(0, {
      timeout: 30_000,
    });

  await step("setup: create a faux bot with known instructions", async () => {
    const bot = await api.post("/bots", { name, modelId: "test-model", systemPrompt: base });
    botId = bot.id;
    cleanup(async () => {
      await api.delete(`/bots/${botId}`);
      expect((await api.get("/bots")).some((b) => b.id === botId)).toBe(false);
    });
    await page.goto(`/chats/${botId}`);
    await expect(composer).toBeVisible({ timeout: 15_000 });
  });

  await step("Tools tab: Update own instructions offers only Ask (always) and Off", async () => {
    await page.getByRole("button", { name: `Edit ${name}` }).click();
    await dialog.getByRole("tab", { name: "Tools" }).click();
    const group = dialog.getByRole("radiogroup", { name: "Update own instructions permission" });
    await expect(group).toBeVisible({ timeout: 15_000 });
    await expect(group.getByRole("radio", { name: "Ask (always)" })).toHaveAttribute(
      "data-state",
      "on",
    );
    await expect(group.getByRole("radio", { name: "Allow" })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).not.toBeVisible();
  });

  await step("/improve shows the approval card with the proposed line", async () => {
    await send(`/improve`);
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toContainText(line);
    // A short payload is not folded.
    await expect(page.getByRole("button", { name: "Read more" })).toHaveCount(0);
  });
  await proof("card");

  await step("Deny: instructions stay unchanged", async () => {
    await page.getByRole("button", { name: "Deny", exact: true }).click();
    await expect(card).toHaveCount(0, { timeout: 15_000 });
    await expect(
      page.getByRole("button", { name: /^Updated own instructions .* denied by you/ }),
    ).toBeVisible({ timeout: 15_000 });
    await settled();
    expect(await prompt()).toBe(base);
  });
  await proof("denied");

  await step("Approve: the line is appended to the bot's instructions", async () => {
    await send(`/improve`);
    await expect(card).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(card).toHaveCount(0, { timeout: 15_000 });
    // The denied row plus this one, which ran.
    await expect(page.getByRole("button", { name: /^Updated own instructions/ })).toHaveCount(2, {
      timeout: 15_000,
    });
    await settled();
    await expect.poll(prompt).toContain(line);
    expect(await prompt()).toContain(base);
  });
  await step("second view: Edit bot → System prompt shows the new instructions", async () => {
    await page.reload();
    await page.getByRole("button", { name: `Edit ${name}` }).click({ timeout: 15_000 });
    const field = dialog.getByLabel("System prompt");
    await expect(field).toHaveValue(new RegExp(`${base}[\\s\\S]*${line}`));
  });
  await proof("approved-editor");
  await step("close the editor", async () => {
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).not.toBeVisible();
  });

  await step("Always allow on an Ask (always) tool still asks next time", async () => {
    await send(`/improve`);
    await expect(card).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Always allow", exact: true }).click();
    await expect(card).toHaveCount(0, { timeout: 15_000 });
    await settled();
    await expect.poll(async () => (await prompt()).split(line).length - 1).toBe(2);
    await send(`/improve`);
    await expect(card).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Deny", exact: true }).click();
    await expect(card).toHaveCount(0, { timeout: 15_000 });
    await settled();
    expect((await prompt()).split(line).length - 1).toBe(2);
  });

  await step("/improve long folds the proposal behind Read more", async () => {
    await send(`/improve long`);
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(longTail)).toHaveCount(0);
    const more = page.getByRole("button", { name: "Read more" });
    await expect(more).toHaveAttribute("aria-expanded", "false");
    await more.click();
    await expect(page.getByRole("button", { name: "Read less" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(page.getByText(longTail)).toBeVisible();
  });
  await proof("read-more");
  await step("approve the long change: the whole paragraph is applied", async () => {
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(card).toHaveCount(0, { timeout: 15_000 });
    await settled();
    await expect.poll(prompt).toContain(longTail);
    expect(await prompt()).toContain(longHead);
  });
});
