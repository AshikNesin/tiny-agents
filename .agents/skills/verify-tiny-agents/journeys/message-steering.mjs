// Feature: message-steering (features/message-steering.md). Sending while the bot
// replies: steer (Enter), follow-up (Alt+Enter / queue button), held messages that
// survive a reload, cancel (x), and Stop/Esc withdrawing everything held.
import { journey, expect } from "../scripts/lib.mjs";

await journey("message-steering", async ({ page, step, proof, cleanup, api, stamp }) => {
  const name = `Steer Bot ${stamp}`;
  const composer = page.getByPlaceholder(`Message ${name}`);
  const stopButton = page.getByRole("button", { name: "Stop generating" });
  const sendButton = page.getByRole("button", { name: "Send message" });
  const steerButton = page.getByRole("button", { name: "Steer the reply" });
  const queueButton = page.getByRole("button", { name: "Queue for after this reply" });
  const held = page.getByTestId("queued-bubble");
  // The faux model streams at 6 tokens/s: ~40 words keep the bot busy for a while.
  const long = (tag) => `${tag} ${Array.from({ length: 40 }, (_, i) => `w${i}`).join(" ")}`;
  let botId;

  /** Send a long message and wait until the bot is visibly replying. */
  const startLongReply = async (tag) => {
    await expect(sendButton).toBeVisible({ timeout: 90_000 });
    await composer.fill(long(tag));
    await composer.press("Enter");
    await expect(stopButton).toBeVisible({ timeout: 15_000 });
  };
  const idle = () => expect(sendButton).toBeVisible({ timeout: 90_000 });

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

  await step("while busy: one Stop button, typing turns it into Steer + Queue", async () => {
    await startLongReply(`first-${stamp}`);
    await expect(page.getByTestId("composer-hint")).toHaveText(
      "Enter steers · Alt+Enter queues · Esc stops",
    );
    await expect(composer).toBeEnabled();
    await composer.fill(`steer cancel ${stamp}`);
    await expect(steerButton).toBeVisible();
    await expect(queueButton).toBeVisible();
    await expect(stopButton).toHaveCount(0);
  });
  await proof("busy-typing");

  await step("Enter steers: a held 'Steering' row that survives a reload", async () => {
    await composer.press("Enter");
    await expect(held).toBeVisible({ timeout: 15_000 });
    await expect(held).toHaveAttribute("data-mode", "steer");
    await expect(held).toContainText("Steering");
    await expect(held).toContainText(`steer cancel ${stamp}`);
    await page.reload();
    await expect(held.filter({ hasText: `steer cancel ${stamp}` })).toBeVisible({
      timeout: 15_000,
    });
  });
  await proof("held-after-reload");

  await step("cancel (x) withdraws it: it never reaches the chat", async () => {
    await held.getByRole("button", { name: "Cancel this message" }).click();
    await expect(held).toHaveCount(0, { timeout: 15_000 });
    await idle();
    await expect(page.getByText(`Echo: first-${stamp}`, { exact: false }).first()).toBeVisible();
    await expect(page.getByText(`steer cancel ${stamp}`)).toHaveCount(0);
  });

  await step("a steer that is kept joins the reply and gets answered", async () => {
    await startLongReply(`second-${stamp}`);
    await composer.fill(`steer kept ${stamp}`);
    await composer.press("Enter");
    await expect(held).toHaveAttribute("data-mode", "steer", { timeout: 15_000 });
    // Placed: the held row turns into a real message and the bot answers it.
    await expect(page.getByText(`Echo: steer kept ${stamp}`).first()).toBeVisible({
      timeout: 90_000,
    });
    await expect(held).toHaveCount(0);
  });
  await proof("steer-answered");

  await step("Alt+Enter queues a follow-up, answered after the reply", async () => {
    await idle();
    await startLongReply(`third-${stamp}`);
    await composer.fill(`follow alt ${stamp}`);
    await composer.press("Alt+Enter");
    await expect(held).toHaveAttribute("data-mode", "followUp", { timeout: 15_000 });
    await expect(held).toContainText("Queued");
    await proof("followup-queued");
    await expect(page.getByText(`Echo: follow alt ${stamp}`).first()).toBeVisible({
      timeout: 90_000,
    });
    await expect(held).toHaveCount(0);
  });

  await step("the queue button also holds a follow-up", async () => {
    await idle();
    await startLongReply(`fourth-${stamp}`);
    await composer.fill(`follow button ${stamp}`);
    await queueButton.click();
    await expect(held).toHaveAttribute("data-mode", "followUp", { timeout: 15_000 });
    await expect(held).toContainText(`follow button ${stamp}`);
    await expect(page.getByText(`Echo: follow button ${stamp}`).first()).toBeVisible({
      timeout: 90_000,
    });
  });

  await step("Esc stops the reply and withdraws what was held", async () => {
    await idle();
    await startLongReply(`fifth-${stamp}`);
    await composer.fill(`dropped ${stamp}`);
    await composer.press("Alt+Enter");
    await expect(held).toBeVisible({ timeout: 15_000 });
    await expect(composer).toHaveValue("");
    await composer.press("Escape");
    await expect(held).toHaveCount(0, { timeout: 15_000 });
    await expect(sendButton).toBeVisible({ timeout: 15_000 });
    // The cut-off reply never finished, and the held message never landed.
    await expect(page.getByText(new RegExp(`Echo: fifth-${stamp}[\\s\\S]*w39`))).toHaveCount(0);
    await page.waitForTimeout(3_000);
    await expect(page.getByText(`dropped ${stamp}`)).toHaveCount(0);
  });
  await proof("stopped");
});
