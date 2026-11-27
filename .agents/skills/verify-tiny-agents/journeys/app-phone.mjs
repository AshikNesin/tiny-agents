// Feature: account-shell (features/account-shell.md), on a phone: each page has one menu button,
// and a Settings link opened straight from the address bar lands on its own section.
import { devices } from "@playwright/test";
import { journey, expect, login } from "../scripts/lib.mjs";

await journey("app-phone", async ({ page: desktop, step, cleanup }) => {
  const context = await desktop
    .context()
    .browser()
    .newContext({ ...devices["iPhone 13"], baseURL: process.env.TA_VERIFY_URL });
  cleanup(() => context.close());
  await context.route("https://feedbackbee.nesin.io/**", (route) => route.abort());
  const page = await context.newPage();
  const dir = `${process.env.TA_VERIFY_EVIDENCE}/app-phone`;
  await login(page);

  for (const path of ["/vault", "/memory", "/routines", "/skills"]) {
    await step(`${path} shows one menu button`, async () => {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole("button", { name: "Open menu" })).toHaveCount(1);
    });
  }
  await page.screenshot({ path: `${dir}/one-menu.png` });

  await step("a Settings link opened directly stays on its section", async () => {
    await page.goto("/settings/notifications");
    await expect(page.getByRole("heading", { level: 1, name: "Notifications" })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page).toHaveURL(/\/settings\/notifications$/);
  });
  await page.screenshot({ path: `${dir}/settings-link.png` });
});
