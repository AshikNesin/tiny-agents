import { test, expect } from "@playwright/test";

/**
 * Bot editor, Tools tab: the per-tool Allow/Ask/Off segmented control.
 * Regression: the dark theme made `--muted` identical to the dialog/card
 * surfaces, so the `data-[state=on]:bg-muted` selection was invisible and
 * the control looked dead. The selected option must be visibly distinct.
 */

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("demo@example.com");
  await page.getByLabel(/password/i).fill("demo@example.com");
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page).toHaveURL(/\/chats(\/[^/]+)?$/);
}

test("Allow/Ask/Off toggle changes on click and the selection is visible", async ({ page }) => {
  await login(page);

  // Create a fresh bot (names are unique, issue #80, and the database
  // outlives a run).
  const name = `Toggle Probe ${Date.now()}`;
  await page
    .getByRole("button", { name: /new bot/i })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: /create bot/i }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 15_000 });

  // Open its edit dialog and go to Tools.
  await page.getByRole("button", { name: `Edit ${name}` }).click({ timeout: 15_000 });
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("tab", { name: "Tools" }).click();

  // Every bot has every toolkit: a new bot's task tools are listed already.
  const group = dialog.getByRole("radiogroup", { name: "Add a task permission" });
  await expect(group).toBeVisible({ timeout: 15_000 });
  const off = group.getByRole("radio", { name: "Off" });
  const ask = group.getByRole("radio", { name: "Ask" });

  // A writable tool defaults to Ask.
  await expect(ask).toHaveAttribute("data-state", "on");

  // The selected option must be visibly distinct from the unselected ones.
  const [onBg, offBg] = await ask.evaluate((el) => {
    const on = getComputedStyle(el).backgroundColor;
    const sibling = el.parentElement!.querySelector('[data-state="off"]')!;
    return [on, getComputedStyle(sibling).backgroundColor];
  });
  expect(onBg).not.toBe(offBg);

  // Clicking another option moves the selection.
  await off.click();
  await expect(off).toHaveAttribute("data-state", "on");
  await expect(ask).toHaveAttribute("data-state", "off");
});
