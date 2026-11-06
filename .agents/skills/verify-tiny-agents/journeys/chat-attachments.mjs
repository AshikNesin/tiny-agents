// Feature: chat-attachments (features/chat-attachments.md). Image + text via the
// composer's file picker, render, enlarge, reload, image-only send, a text file's
// preview, removing a staged file and a refused upload.
import { journey, expect } from "../scripts/lib.mjs";

// A real 1x1 PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

await journey("chat-attachments", async ({ page, step, proof, cleanup, api, stamp }) => {
  const name = `Attach Bot ${stamp}`;
  const composer = page.getByPlaceholder(`Message ${name}`);
  const shot = `shot-${stamp}.png`;
  const only = `only-${stamp}.png`;
  const notes = `notes-${stamp}.txt`;
  const bogus = `fake-${stamp}.pdf`;
  let botId;
  let big = PNG;

  /** The user path: "+" → "Add files or images" → the OS file chooser. */
  const attach = async (files) => {
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Add files or mention a bot" }).click();
    await page.getByRole("menuitem", { name: /Add files or images/ }).click();
    await (await chooser).setFiles(files);
  };
  const sendButton = page.getByRole("button", { name: "Send message" });

  await step("setup: a bot of its own via the API", async () => {
    const { defaultModel } = await api.get("/models");
    botId = (await api.post("/bots", { name, modelId: defaultModel })).id;
    cleanup(async () => {
      await api.delete(`/bots/${botId}`);
      expect((await api.get("/bots")).some((b) => b.id === botId)).toBe(false);
    });
    await page.goto(`/chats/${botId}`);
    await expect(composer).toBeVisible({ timeout: 15_000 });
  });

  await step("stage an image through the file picker", async () => {
    // A 320x200 PNG (a crop of the app itself), so the enlarged view has something to show.
    big = await page.screenshot({ clip: { x: 0, y: 0, width: 320, height: 200 } });
    await attach({ name: shot, mimeType: "image/png", buffer: big });
    await expect(page.getByTestId("staged-image")).toBeVisible();
    await expect(page.getByTestId("staged-strip").getByAltText(shot)).toBeVisible();
    // Upload settles: Send enables with nothing typed.
    await expect(sendButton).toBeEnabled({ timeout: 15_000 });
  });
  await proof("staged");

  await step("send image + text: bubble shows the image, the bot replies", async () => {
    await composer.fill(`what is this ${stamp}?`);
    await sendButton.click();
    await expect(page.getByTestId("staged-strip")).toHaveCount(0);
    await expect(page.getByText(`what is this ${stamp}?`).first()).toBeVisible();
    await expect(page.getByRole("button", { name: `Enlarge ${shot}` })).toBeVisible();
    await expect(
      page.getByText(new RegExp(`Echo:[\\s\\S]*what is this ${stamp}`)).first(),
    ).toBeVisible({
      timeout: 45_000,
    });
  });
  await proof("sent-image");

  await step("reload: the image still renders from the server", async () => {
    await page.reload();
    const img = page.getByRole("button", { name: `Enlarge ${shot}` }).getByRole("img");
    await expect(img).toBeVisible({ timeout: 15_000 });
    // Really loaded (served bytes), not a broken image.
    await expect.poll(() => img.evaluate((el) => el.naturalWidth)).toBeGreaterThan(0);
  });

  await step("image-only send: no text needed, sidebar preview reads [Image]", async () => {
    await expect(sendButton).toBeVisible({ timeout: 45_000 });
    await attach({ name: only, mimeType: "image/png", buffer: big });
    await expect(page.getByTestId("staged-strip").getByAltText(only)).toBeVisible();
    await expect(sendButton).toBeEnabled({ timeout: 15_000 });
    await sendButton.click();
    await expect(page.getByRole("button", { name: `Enlarge ${only}` })).toBeVisible({
      timeout: 15_000,
    });
    // The bot list previews an image-only send as "[Image] <name>" until the reply lands.
    await expect
      .poll(async () => (await api.get("/bots")).find((b) => b.id === botId)?.lastMessagePreview, {
        intervals: [100],
        timeout: 5_000,
      })
      .toBe(`[Image] ${only}`);
    // The first image's bubble is still there: two image sends don't swallow each other.
    await expect(page.getByRole("button", { name: `Enlarge ${shot}` })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: `Enlarge ${only}` })).toBeVisible({
      timeout: 15_000,
    });
  });
  await proof("image-only");

  await step("remove a staged file before sending", async () => {
    await attach({ name: `drop-${stamp}.png`, mimeType: "image/png", buffer: PNG });
    await expect(page.getByTestId("staged-strip").getByAltText(`drop-${stamp}.png`)).toBeVisible();
    await page.getByRole("button", { name: `Remove drop-${stamp}.png` }).click();
    await expect(page.getByTestId("staged-strip")).toHaveCount(0);
  });

  await step("a text file: chip, sent, preview shows its text", async () => {
    // Wait until the bot is idle so this send is a plain message, not a steer.
    await expect(sendButton).toBeVisible({ timeout: 45_000 });
    await attach({
      name: notes,
      mimeType: "text/plain",
      buffer: Buffer.from(`alpha line ${stamp}\nbeta line\n`),
    });
    const strip = page.getByTestId("staged-strip");
    await expect(strip.getByText(notes)).toBeVisible();
    await expect(sendButton).toBeEnabled({ timeout: 15_000 });
    await composer.fill(`read the notes ${stamp}`);
    await sendButton.click();
    const chip = page.getByRole("button", { name: `Preview ${notes}` });
    await expect(chip).toBeVisible({ timeout: 15_000 });
    // Extraction finishes: the chip shows a line count.
    await expect(chip).toContainText(/lines?|ready/, { timeout: 20_000 });
    await expect(page.getByRole("link", { name: `Download ${notes}` })).toBeVisible();
    await chip.click();
    const preview = page.getByRole("dialog", { name: notes });
    await expect(preview).toBeVisible();
    await expect(preview.getByText(`alpha line ${stamp}`)).toBeVisible({ timeout: 15_000 });
    await proof("file-preview");
    await page.keyboard.press("Escape");
    await expect(preview).toHaveCount(0);
  });

  await step("the bot reads the file's text (inline in its turn)", async () => {
    await expect(
      page.getByText(new RegExp(`Echo:[\\s\\S]*alpha line ${stamp}`)).first(),
    ).toBeVisible({
      timeout: 60_000,
    });
  });
  await proof("file-read");

  await step("a file whose bytes don't match its type is refused", async () => {
    await attach({
      name: bogus,
      mimeType: "application/pdf",
      buffer: Buffer.from("this is not a pdf at all"),
    });
    await expect(page.getByRole("img", { name: new RegExp(`^${bogus}:`) })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("staged-strip").getByText("Upload failed")).toBeVisible();
    await proof("refused");
    await page.getByRole("button", { name: `Remove ${bogus}` }).click();
    await expect(page.getByTestId("staged-strip")).toHaveCount(0);
  });
  await step("enlarge an image: a full-window viewer that closes", async () => {
    await page.getByRole("button", { name: `Enlarge ${shot}` }).click();
    const viewer = page.getByRole("dialog", { name: `Image ${shot}` });
    await expect(viewer).toBeVisible();
    await expect(viewer.getByRole("img", { name: shot })).toBeVisible();
    await proof("enlarged");
    // The viewer is a lightbox over the whole window, not a box inside the bubble.
    const box = await viewer.boundingBox();
    const view = page.viewportSize();
    expect(box, "viewer has a box").toBeTruthy();
    expect(Math.round(box.width), "viewer spans the window width").toBeGreaterThanOrEqual(
      view.width - 2,
    );
    expect(Math.round(box.height), "viewer spans the window height").toBeGreaterThanOrEqual(
      view.height - 2,
    );
    await viewer.getByRole("button", { name: "Close image" }).click({ timeout: 5_000 });
    await expect(viewer).toHaveCount(0);
  });
});
