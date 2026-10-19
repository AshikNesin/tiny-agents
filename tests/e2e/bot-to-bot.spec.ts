import { test, expect } from "@playwright/test";

/**
 * Bot-to-bot e2e (issue #12), on the faux provider (echo replies, no
 * network). Two bots: a host the owner chats with and a guest tagged via
 * the composer. The guest echoes the attributed copy; the relay carries
 * that echo back into the host transcript as a new user turn, and the
 * host echoes it again. Full circle, watchable in one chat.
 */

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill("demo@example.com");
  await page.getByLabel(/password/i).fill("demo@example.com");
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page).toHaveURL(/\/chats$/);
}

async function createBot(page: import("@playwright/test").Page, name: string) {
  await page
    .getByRole("button", { name: /new bot/i })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("button", { name: "Test Model (faux)" })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: /create bot/i }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 15_000 });
}

test.describe("Bot to bot", () => {
  test("tagging a bot in the composer reaches it and the reply relays back", async ({ page }) => {
    await login(page);

    await createBot(page, "Relay Guest");
    await page.goto("/chats");
    await createBot(page, "Relay Host");
    // Creating a bot navigates into its chat; the host is the open one.
    // Two bots exist now, so the placeholder advertises @mentions.
    const composer = page.getByPlaceholder(/message relay host/i);
    await expect(composer).toBeVisible({ timeout: 15_000 });

    await composer.fill("what do you think @Relay Guest");
    await composer.press("Enter");

    // The owner's message is in the host transcript.
    await expect(page.getByText("what do you think @Relay Guest").first()).toBeVisible();

    // The guest echoed the attributed copy; the relay brought it back into
    // the host chat as "**Reply from Relay Guest:** Echo: [From the owner…".
    await expect(page.getByText(/Reply from Relay Guest:/i).first()).toBeVisible({
      timeout: 30_000,
    });

    // The guest's own chat shows the attributed copy it received.
    await page
      .getByRole("button", { name: /relay guest/i })
      .first()
      .click();
    await expect(page.getByText(/From the owner, in Relay Host's chat/i).first()).toBeVisible({
      timeout: 15_000,
    });
  });
});
