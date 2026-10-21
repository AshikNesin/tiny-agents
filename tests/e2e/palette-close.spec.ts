import { test, expect } from "@playwright/test";

test("command palette closes on outside click", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill("demo@example.com");
  await page.getByLabel(/password/i).fill("demo@example.com");
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page).toHaveURL(/\/chats$/);

  await page.getByRole("button", { name: /^search/i }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  // Real pointer click on the overlay (viewport corner).
  await page.mouse.click(8, 300);
  await expect(dialog).not.toBeVisible();
});
