// Feature: yolo (features/yolo.md). Per-chat YOLO switch in the bot menu: confirm dialog,
// banner, survives reload, Ask (always) tools run unasked and show
// "auto-approved (YOLO)", turning it on approves a waiting card, Turn off
// brings cards back, New chat turns it off.
import { journey, expect } from "../scripts/lib.mjs";

await journey("yolo", async ({ page, step, proof, cleanup, api, stamp }) => {
  const name = `Yolo Bot ${stamp}`;
  const base = `Base prompt ${stamp}.`;
  const line = "Self-improvement e2e: append this line.";
  const composer = page.getByRole("textbox", { name: `Message ${name}` });
  // The switch is a checkbox row in the bot menu (the header's bot name).
  const toggle = page.getByTestId("yolo-toggle");
  const openMenu = () => page.getByRole("button", { name: `${name} menu` }).click();
  const clickToggle = async () => {
    await openMenu();
    await toggle.click();
  };
  const expectYolo = async (on) => {
    await openMenu();
    await expect(toggle).toHaveAttribute("aria-checked", String(on), { timeout: 15_000 });
    await page.keyboard.press("Escape");
    await expect(toggle).toHaveCount(0);
  };
  const banner = page.getByTestId("yolo-banner");
  const card = page.getByText(`${name} wants to update own instructions`);
  const yoloRows = page.getByText(/auto-approved \(YOLO\)/);
  const confirm = page.getByRole("dialog", { name: "Turn on YOLO mode?" });
  let botId;

  const send = async (text) => {
    await composer.fill(text);
    await composer.press("Enter");
  };
  const prompt = async () => (await api.get(`/bots/${botId}`)).systemPrompt;
  const lines = async () => (await prompt()).split(line).length - 1;
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
    await expectYolo(false);
  });

  await step("Cancel in the confirm dialog leaves YOLO off", async () => {
    await clickToggle();
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(confirm).not.toBeVisible();
    await expectYolo(false);
    await expect(banner).toHaveCount(0);
  });
  await step("Turn on: menu row checked, banner shown", async () => {
    await clickToggle();
    await confirm.getByRole("button", { name: "Turn on", exact: true }).click();
    await expect(banner).toContainText("YOLO on: tools run without asking");
    await expectYolo(true);
  });
  await step("YOLO survives a reload (server-side, per chat)", async () => {
    await page.reload();
    await expect(banner).toBeVisible({ timeout: 15_000 });
    await expectYolo(true);
  });
  await proof("on");

  await step("an Ask (always) tool runs without a card and is marked YOLO", async () => {
    await send("/improve");
    await expect(yoloRows.first()).toBeVisible({ timeout: 30_000 });
    await settled();
    await expect(card).toHaveCount(0);
    await expect.poll(lines).toBe(1);
  });
  await proof("auto-approved");

  await step("Turn off from the banner: a card asks again", async () => {
    await banner.getByRole("button", { name: "Turn off" }).click();
    await expect(banner).toHaveCount(0);
    await expectYolo(false);
    await send("/improve");
    await expect(card).toBeVisible({ timeout: 30_000 });
    expect(await lines(), "nothing applied while the card waits").toBe(1);
  });
  await proof("card-again");

  await step("turning YOLO on approves the card already waiting", async () => {
    await clickToggle();
    await confirm.getByRole("button", { name: "Turn on", exact: true }).click();
    await expect(banner).toBeVisible();
    await expect(card).toHaveCount(0, { timeout: 15_000 });
    // The waiting call ran. Its row is recorded as an ordinary approval
    // ("waited … for you"), not "auto-approved (YOLO)": see features/yolo.md Gotchas.
    await expect(page.getByRole("button", { name: /^Updated own instructions/ })).toHaveCount(2, {
      timeout: 30_000,
    });
    await settled();
    await expect.poll(lines).toBe(2);
  });
  await proof("waiting-approved");

  await step("New chat turns YOLO off", async () => {
    await page.getByRole("button", { name: "Start a new chat" }).click();
    await page.getByRole("button", { name: "New chat", exact: true }).click();
    await expect(banner).toHaveCount(0, { timeout: 15_000 });
    await expectYolo(false);
    await page.reload();
    await expect(composer).toBeVisible({ timeout: 15_000 });
    await expectYolo(false);
  });
  await proof("new-chat-off");
});
