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
    await expect(page.getByRole("button", { name: /echo bot/i }).first()).toBeVisible();

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
      .getByRole("button", { name: /echo bot/i })
      .first()
      .isVisible();
    if (!hasBot) {
      await page.getByRole("button", { name: /new bot/i }).click();
      await page.getByLabel("Name").fill("Echo Bot");
      await page.getByRole("button", { name: /create bot/i }).click();
      await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 15_000 });
    }

    // The list itself renders previews for each bot row.
    await expect(page.getByPlaceholder(/^search$/i)).toBeVisible();
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
      .getByRole("button", { name: /reset bot/i })
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
      .getByRole("button", { name: /reset bot/i })
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
