import { expect, type Page } from "@playwright/test";

/**
 * Log in through the real UI as the seeded demo user and wait for the app.
 * Shares the page context's cookie with page.request, so REST calls after
 * this are authenticated.
 */
export async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("demo@example.com");
  await page.getByLabel(/password/i).fill("demo@example.com");
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page).toHaveURL(/\/chats$/);
}
