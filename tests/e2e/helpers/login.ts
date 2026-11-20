import { expect, type Page } from "@playwright/test";

export async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("demo@example.com");
  await page.getByLabel(/password/i).fill("demo@example.com");
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/api/v1/auth/login") && r.request().method() === "POST",
    ),
    page.getByRole("button", { name: "Sign In", exact: true }).click(),
  ]);
  expect(
    response.status(),
    "login was rate-limited (429): is AUTH_RATE_LIMIT_MAX set on the server?",
  ).not.toBe(429);
  await expect(page).toHaveURL(/\/chats(\/[^/]+)?$/);
}
