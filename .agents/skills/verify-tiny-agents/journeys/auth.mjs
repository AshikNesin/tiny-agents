// Feature: auth (features/auth.md). Wrong password, sign in, sign out, protected redirect.
import { journey, expect, DEMO, login } from "../scripts/lib.mjs";

await journey(
  "auth",
  async ({ page, step, proof }) => {
    await step("login page renders", async () => {
      await page.goto("/login");
      await expect(page.getByRole("heading", { name: /welcome back/i })).toBeVisible();
    });
    await step("wrong password shows human error and stays on /login", async () => {
      await page.getByLabel("Email", { exact: true }).fill(DEMO.email);
      await page.getByLabel(/password/i).fill("not-the-password");
      await page.getByRole("button", { name: "Sign In", exact: true }).click();
      await expect(page.getByText("Invalid email or password.")).toBeVisible();
      await expect(page).toHaveURL(/\/login/);
      await expect(page.getByText(/Request failed with status code/)).toHaveCount(0);
    });
    await proof("wrong-password");
    await step("correct password lands on /chats", () => login(page));
    await step("session cookie answers /auth/me", async () => {
      const me = await page.request.get("/api/v1/auth/me");
      expect(me.status()).toBe(200);
      expect((await me.json()).data.email).toBe(DEMO.email);
    });
    await proof("signed-in");
    await step("log out from the account menu", async () => {
      await page.getByRole("button", { name: /account and navigation/i }).click();
      await page.getByRole("menuitem", { name: /log out/i }).click();
      await expect(page).toHaveURL(/\/login/);
    });
    await step("protected page bounces to /login and API refuses", async () => {
      await page.goto("/tasks");
      await expect(page).toHaveURL(/\/login/);
      expect((await page.request.get("/api/v1/auth/me")).status()).toBe(401);
    });
    await proof("signed-out");
  },
  { signIn: false },
);
