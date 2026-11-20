import { test, expect } from "@playwright/test";

test.describe("Logout (authenticated)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill("demo@example.com");
    await page.getByLabel(/password/i).fill("demo@example.com");
    await page.getByRole("button", { name: "Sign In", exact: true }).click();
    await page.waitForURL(/\/(chats|todos|dashboard)/);
  });

  async function openUserMenu(page: import("@playwright/test").Page) {
    await page.getByRole("button", { name: /account and navigation/i }).click();
  }

  test("can log out from the user menu", async ({ page }) => {
    await openUserMenu(page);
    await page.getByRole("menuitem", { name: /log out/i }).click();

    await expect(page).toHaveURL(/.*login.*/);
    await expect(page.getByRole("heading", { name: /welcome back/i })).toBeVisible();
  });

  test("protected pages redirect to login after logout", async ({ page }) => {
    await openUserMenu(page);
    await page.getByRole("menuitem", { name: /log out/i }).click();
    await expect(page).toHaveURL(/.*login.*/);

    await page.goto("/chats");
    await expect(page).toHaveURL(/.*login.*/);
  });
});
