import { test, expect } from "@playwright/test";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("demo@example.com");
  await page.getByLabel(/password/i).fill("demo@example.com");
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page).toHaveURL(/\/chats(\/[^/]+)?$/);
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

    const stamp = Date.now();
    const guest = `Relay Guest ${stamp}`;
    const host = `Relay Host ${stamp}`;
    await createBot(page, guest);
    await page.goto("/chats");
    await createBot(page, host);
    const composer = page.getByPlaceholder(`Message ${host}`);
    await expect(composer).toBeVisible({ timeout: 15_000 });

    await composer.fill(`what do you think @${guest}`);
    await composer.press("Enter");

    await expect(page.getByText(`what do you think @${guest}`).first()).toBeVisible();

    const relayCard = page.getByTestId("peer-card").filter({ hasText: guest });
    await expect(relayCard.first()).toBeVisible({ timeout: 30_000 });
    await expect(relayCard.first()).toContainText("reply relayed into this chat");
    await expect(relayCard.first()).toContainText(/Echo: \[From the owner/);
    await expect(
      page.locator('[data-slot="bubble"]').filter({ hasText: `Reply from ${guest}:` }),
    ).toHaveCount(0);

    await page
      .getByRole("link", { name: new RegExp(`^${guest}`) })
      .first()
      .click();
    await expect(page.getByRole("button", { name: `${guest} menu` })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(`You · in ${host}'s chat`).first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.locator('[data-slot="bubble"]').filter({ hasText: "From the owner, in" }),
    ).toHaveCount(0);
  });
});
