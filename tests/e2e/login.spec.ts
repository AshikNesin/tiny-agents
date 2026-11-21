import { test, expect } from "@playwright/test";

test.describe("Login page", () => {
  test("login page loads", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: /welcome back/i })).toBeVisible();
  });

  test("can login with test user", async ({ page }) => {
    await page.goto("/login");

    await page.getByLabel("Email", { exact: true }).fill("demo@example.com");
    await page.getByLabel(/password/i).fill("demo@example.com");
    await page.getByRole("button", { name: "Sign In", exact: true }).click();

    await expect(page).not.toHaveURL(/.*login.*/);
  });

  test("shows error with invalid credentials", async ({ page }) => {
    await page.goto("/login");

    await page.getByLabel("Email", { exact: true }).fill("wrong@example.com");
    await page.getByLabel(/password/i).fill("wrongpassword");
    await page.getByRole("button", { name: "Sign In", exact: true }).click();

    await expect(page).toHaveURL(/.*login.*/);

    const toast = page.getByText("Invalid email or password.");
    await expect(toast).toBeVisible();
    await expect(page.getByText(/Request failed with status code/)).toHaveCount(0);
  });
});
