// Feature: setup (features/setup.md). First-run /setup on an empty instance: /login redirects
// to it, validation, create the first account and land signed in; afterwards /setup is closed.
// Needs `ta-verify up --empty`; one drive per empty run (the first account cannot be removed).
import { journey, expect } from "../scripts/lib.mjs";

await journey(
  "setup",
  async ({ page, step, proof, stamp }) => {
    const email = `owner-${stamp}@example.com`;
    const password = `pw-${stamp}`; // gitleaks:allow (throwaway test password)
    const name = `Verify Owner ${stamp}`;

    await step("an empty instance reports needsSetup", async () => {
      const res = await page.request.get("/api/v1/auth/setup");
      expect(res.status()).toBe(200);
      expect((await res.json()).data.needsSetup).toBe(true);
    });
    await step("/login sends a fresh install to /setup", async () => {
      await page.goto("/login");
      await expect(page).toHaveURL(/\/setup$/);
      await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
      await expect(page.getByText("No users exist yet.")).toBeVisible();
    });
    await proof("setup-form");
    await step("the browser blocks a malformed email before submit", async () => {
      await page.getByLabel("Email", { exact: true }).fill("not-an-email");
      await page.getByRole("button", { name: "Create account" }).click();
      const valid = await page
        .getByLabel("Email", { exact: true })
        .evaluate((input) => input.validity.valid);
      expect(valid, "type=email input reports invalid").toBe(false);
      await expect(page).toHaveURL(/\/setup$/);
    });
    await step("form validation: email, short password, mismatched confirmation", async () => {
      // "a@b" passes the browser's type=email check but not the form's schema.
      await page.getByLabel("Email", { exact: true }).fill("a@b");
      await page.getByLabel("Password", { exact: true }).fill("123"); // gitleaks:allow (throwaway test password)
      await page.getByLabel("Confirm password").fill("456"); // gitleaks:allow (throwaway test password)
      await page.getByRole("button", { name: "Create account" }).click();
      await expect(page.getByText("Invalid email address")).toBeVisible();
      await expect(page.getByText("Password must be at least 6 characters")).toBeVisible();
      await expect(page.getByText("Passwords do not match")).toBeVisible();
      await expect(page).toHaveURL(/\/setup$/);
      const res = await page.request.get("/api/v1/auth/setup");
      expect((await res.json()).data.needsSetup, "nothing was created").toBe(true);
    });
    await proof("setup-validation");
    await step("create the first account: signed in, lands in the app", async () => {
      await page.getByLabel("Name (optional)").fill(name);
      await page.getByLabel("Email", { exact: true }).fill(email);
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.getByLabel("Confirm password").fill(password);
      await page.getByRole("button", { name: "Create account" }).click();
      await expect(page.getByText(`Signed in as ${email}.`)).toBeVisible();
      await expect(page).toHaveURL(/\/chats(\/[^/]+)?$/);
      await expect(page.getByRole("button", { name: "Account and navigation" })).toContainText(
        name,
      );
      const me = await page.request.get("/api/v1/auth/me");
      expect(me.status()).toBe(200);
      expect((await me.json()).data.email).toBe(email);
    });
    await proof("signed-in");
    await step("setup is closed: needsSetup false, a second POST is refused", async () => {
      const res = await page.request.get("/api/v1/auth/setup");
      expect((await res.json()).data.needsSetup).toBe(false);
      const again = await page.request.post("/api/v1/auth/setup", {
        data: { email: `second-${stamp}@example.com`, password: "secret123" }, // gitleaks:allow (throwaway test password)
      });
      expect(again.status()).toBe(403);
    });
    await step("log out; /setup now redirects to /login", async () => {
      await page.getByRole("button", { name: "Account and navigation" }).click();
      await page.getByRole("menuitem", { name: "Log out" }).click();
      await expect(page).toHaveURL(/\/login/);
      await page.goto("/setup");
      await expect(page).toHaveURL(/\/login$/);
      await expect(page.getByRole("heading", { name: /welcome back/i })).toBeVisible();
    });
    await proof("setup-closed");
    await step("the new account signs in with its password", async () => {
      await page.getByLabel("Email", { exact: true }).fill(email);
      await page.getByLabel(/password/i).fill(password);
      await page.getByRole("button", { name: "Sign In", exact: true }).click();
      await expect(page).toHaveURL(/\/chats(\/[^/]+)?$/);
    });
  },
  { signIn: false, requires: ["empty"] },
);
