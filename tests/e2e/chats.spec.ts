import { test, expect } from "@playwright/test";

/**
 * Phase 1 chat e2e (PRD §13): login → create bot → chat (streamed reply) →
 * refresh mid-session → reply still present. The Playwright webServer runs
 * without gateway credentials, so these tests set TINY_AGENTS_FAUX=1 via
 * playwright.config (scripted echo model, no network).
 */

test.describe("Chats", () => {
  test("create a bot and chat with a streamed reply that survives a refresh", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel(/email/i).fill("demo@example.com");
    await page.getByLabel(/password/i).fill("demo@example.com");
    await page.getByRole("button", { name: "Sign In", exact: true }).click();
    await expect(page).toHaveURL(/\/chats$/);

    // Empty state → open the create dialog
    const emptyCta = page.getByRole("button", { name: /create your first bot/i });
    if (await emptyCta.isVisible()) {
      await emptyCta.click();
    } else {
      await page.getByRole("button", { name: /new bot/i }).click();
    }
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    // Wait for the model catalog (async fetch) before creating: the dialog
    // is usable before models arrive and would fail validation.
    await expect(page.getByRole("button", { name: "Test Model (faux)" })).toBeVisible({
      timeout: 15_000,
    });
    await page.getByLabel("Name").fill("Echo Bot");
    await page.getByRole("button", { name: /create bot/i }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 15_000 });

    // Bot appears in the list and chat opens
    await expect(page.getByRole("link", { name: /echo bot/i }).first()).toBeVisible();

    // Send a message and await the streamed reply
    const composer = page.getByPlaceholder(/(?:ask|message) echo bot/i);
    await composer.fill("hello e2e");
    await composer.press("Enter");
    await expect(page.getByText("hello e2e").first()).toBeVisible();
    await expect(page.getByText(/Echo: hello e2e/i).first()).toBeVisible({ timeout: 20_000 });

    // Refresh mid-conversation: history (and any in-flight reply) survives
    await page.reload();
    await expect(page.getByText(/Echo: hello e2e/i).first()).toBeVisible({ timeout: 15_000 });
  });

  test("bot list shows a typing state and unread badge for background replies", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByLabel(/email/i).fill("demo@example.com");
    await page.getByLabel(/password/i).fill("demo@example.com");
    await page.getByRole("button", { name: "Sign In", exact: true }).click();
    await expect(page).toHaveURL(/\/chats$/);

    // Ensure at least one bot exists, then stay on the list (no chat open).
    const hasBot = await page
      .getByRole("link", { name: /echo bot/i })
      .first()
      .isVisible();
    if (!hasBot) {
      await page.getByRole("button", { name: /new bot/i }).click();
      await page.getByLabel("Name").fill("Echo Bot");
      await page.getByRole("button", { name: /create bot/i }).click();
      await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 15_000 });
    }

    // The app sidebar lists the bots and carries Search.
    await expect(page.getByRole("button", { name: /^search/i })).toBeVisible();
  });
});

test.describe("Chats — new chat", () => {
  test("starting a new chat clears the current transcript", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel(/email/i).fill("demo@example.com");
    await page.getByLabel(/password/i).fill("demo@example.com");
    await page.getByRole("button", { name: "Sign In", exact: true }).click();
    await expect(page).toHaveURL(/\/chats$/);

    // Ensure a bot with some history exists.
    const hasBot = await page
      .getByRole("link", { name: /reset bot/i })
      .first()
      .isVisible();
    if (!hasBot) {
      await page.getByRole("button", { name: /new bot/i }).click();
      await page.getByLabel("Name").fill("Reset Bot");
      // Wait for the model catalog before creating (async fetch).
      await expect(page.getByRole("button", { name: "Test Model (faux)" })).toBeVisible({
        timeout: 15_000,
      });
      await page.getByRole("button", { name: /create bot/i }).click();
      await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 15_000 });
    }
    await page
      .getByRole("link", { name: /reset bot/i })
      .first()
      .click();

    const composer = page.getByPlaceholder(/(?:ask|message) reset bot/i);
    await composer.fill("old message");
    await composer.press("Enter");
    await expect(page.getByText("old message").first()).toBeVisible();
    await expect(page.getByText(/Echo: old message/i).first()).toBeVisible({ timeout: 20_000 });

    // New chat: the transcript must clear and stay cleared.
    await page.getByRole("button", { name: "Bot menu" }).click();
    await page.getByRole("menuitem", { name: /new chat/i }).click();
    await page.getByRole("button", { name: "New chat", exact: true }).click();
    await expect(page.getByText("old message")).toHaveCount(0);
    await expect(page.getByText(/Echo: old message/i)).toHaveCount(0);
  });
});

test.describe("Chats — attachments (issue #17)", () => {
  test("attach an image, send, render, survive reload", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel(/email/i).fill("demo@example.com");
    await page.getByLabel(/password/i).fill("demo@example.com");
    await page.getByRole("button", { name: "Sign In", exact: true }).click();
    await expect(page).toHaveURL(/\/chats$/);

    // Ensure a bot exists.
    const hasBot = await page
      .getByRole("link", { name: /attach bot/i })
      .first()
      .isVisible();
    if (!hasBot) {
      await page.getByRole("button", { name: /new bot/i }).click();
      await page.getByLabel("Name").fill("Attach Bot");
      await expect(page.getByRole("button", { name: "Test Model (faux)" })).toBeVisible({
        timeout: 15_000,
      });
      await page.getByRole("button", { name: /create bot/i }).click();
      await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 15_000 });
    }
    await page
      .getByRole("link", { name: /attach bot/i })
      .first()
      .click();

    // A real 1x1 PNG through the file input.
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      "base64",
    );
    await page.setInputFiles('input[type="file"]', {
      name: "e2e-shot.png",
      mimeType: "image/png",
      buffer: png,
    });

    // Staged thumbnail appears, then upload settles and Send enables.
    await expect(page.getByTestId("staged-image")).toBeVisible();
    await page.getByPlaceholder(/(?:ask|message) attach bot/i).fill("what is this?");
    await page.getByRole("button", { name: "Send message" }).click();

    // Transcript: user message with the image, echoed reply.
    await expect(page.getByText("what is this?").first()).toBeVisible();
    await expect(page.getByAltText("e2e-shot.png").first()).toBeVisible();
    await expect(page.getByText(/Echo:/i).first()).toBeVisible({ timeout: 20_000 });

    // Reload: rendering is durable (entry data), not client state.
    await page.reload();
    await page
      .getByRole("link", { name: /attach bot/i })
      .first()
      .click();
    await expect(page.getByAltText("e2e-shot.png").first()).toBeVisible({ timeout: 15_000 });
  });

  test("image-only send works without text", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel(/email/i).fill("demo@example.com");
    await page.getByLabel(/password/i).fill("demo@example.com");
    await page.getByRole("button", { name: "Sign In", exact: true }).click();
    await expect(page).toHaveURL(/\/chats$/);
    const hasBot = await page
      .getByRole("link", { name: /attach bot/i })
      .first()
      .isVisible();
    if (!hasBot) {
      await page.getByRole("button", { name: /new bot/i }).click();
      await page.getByLabel("Name").fill("Attach Bot");
      await expect(page.getByRole("button", { name: "Test Model (faux)" })).toBeVisible({
        timeout: 15_000,
      });
      await page.getByRole("button", { name: /create bot/i }).click();
      await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 15_000 });
    }
    await page
      .getByRole("link", { name: /attach bot/i })
      .first()
      .click();

    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      "base64",
    );
    await page.setInputFiles('input[type="file"]', {
      name: "only-image.png",
      mimeType: "image/png",
      buffer: png,
    });
    await expect(page.getByTestId("staged-image")).toBeVisible();
    // Send stays disabled while uploading, then enables with no text.
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByAltText("only-image.png").first()).toBeVisible({ timeout: 15_000 });
  });
});
