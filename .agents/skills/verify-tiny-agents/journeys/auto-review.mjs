// Feature: auto-review (features/auto-review.md). The per-bot Auto-review
// switch (Edit bot → Tools) saves and persists. Without a classifier (verify
// runs have no Cloudflare gateway, and the faux runtime wires no reviewer)
// every Ask call keeps its card, and Ask (always) tools always ask. The
// auto-approval itself needs a real classifier: unreachable here.
import { journey, expect } from "../scripts/lib.mjs";

await journey("auto-review", async ({ page, step, proof, cleanup, api, stamp }) => {
  const name = `Review Bot ${stamp}`;
  const composer = page.getByRole("textbox", { name: `Message ${name}` });
  const dialog = page.getByRole("dialog", { name: `Edit ${name}` });
  const autoReview = dialog.getByRole("switch", { name: "Auto-review" });
  let botId;

  const send = async (text) => {
    await composer.fill(text);
    await composer.press("Enter");
  };
  const bot = () => api.get(`/bots/${botId}`);
  const openTools = async () => {
    await page.getByRole("button", { name: `Edit ${name}` }).click({ timeout: 15_000 });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("tab", { name: "Tools" }).click();
    await expect(autoReview).toBeVisible({ timeout: 15_000 });
  };
  const save = async () => {
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog).not.toBeVisible({ timeout: 15_000 });
  };
  const settled = () =>
    expect(page.getByRole("button", { name: "Stop generating" })).toHaveCount(0, {
      timeout: 30_000,
    });

  await step("setup: create a faux bot with Read the page set to Ask", async () => {
    const row = await api.post("/bots", {
      name,
      modelId: "test-model",
      toolPermissions: { browser_snapshot: "ask" },
    });
    botId = row.id;
    cleanup(async () => {
      await api.delete(`/bots/${botId}`);
      expect((await api.get("/bots")).some((b) => b.id === botId)).toBe(false);
    });
    await page.goto(`/chats/${botId}`);
    await expect(composer).toBeVisible({ timeout: 15_000 });
  });

  await step("Auto-review is off by default", async () => {
    await openTools();
    await expect(autoReview).toHaveAttribute("aria-checked", "false");
    expect((await bot()).autoReview).toBe(false);
  });
  await step("switch it on and save: persisted on the bot", async () => {
    await autoReview.click();
    await expect(autoReview).toHaveAttribute("aria-checked", "true");
    await save();
    await expect.poll(async () => (await bot()).autoReview).toBe(true);
  });
  await step("second view: after a reload the switch is still on", async () => {
    await page.reload();
    await openTools();
    await expect(autoReview).toHaveAttribute("aria-checked", "true");
  });
  await proof("on");
  await step("close the editor", async () => {
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).not.toBeVisible();
  });

  await step("no classifier configured: an Ask call still shows its card", async () => {
    await send(`/browse 1 ${stamp}`);
    const card = page.getByText(`${name} wants to read the page`);
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/auto-approved/)).toHaveCount(0);
    await page.getByRole("button", { name: "Deny", exact: true }).click();
    await expect(card).toHaveCount(0, { timeout: 15_000 });
    await settled();
  });
  await step("Ask (always) tools always ask with Auto-review on", async () => {
    await send("/improve");
    const card = page.getByText(`${name} wants to update own instructions`);
    await expect(card).toBeVisible({ timeout: 30_000 });
    await proof("still-asks");
    await page.getByRole("button", { name: "Deny", exact: true }).click();
    await expect(card).toHaveCount(0, { timeout: 15_000 });
    await settled();
    await expect(page.getByText(/auto-approved/)).toHaveCount(0);
  });

  await step("switch it off again: persisted", async () => {
    await openTools();
    await autoReview.click();
    await expect(autoReview).toHaveAttribute("aria-checked", "false");
    await save();
    await expect.poll(async () => (await bot()).autoReview).toBe(false);
  });
  await proof("off");
});
