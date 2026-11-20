import { test, expect } from "@playwright/test";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("demo@example.com");
  await page.getByLabel(/password/i).fill("demo@example.com");
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page).toHaveURL(/\/chats(\/[^/]+)?$/);
}

test("Allow/Ask/Off toggle changes on click and the selection is visible", async ({ page }) => {
  await login(page);

  const name = `Toggle Probe ${Date.now()}`;
  await page
    .getByRole("button", { name: /new bot/i })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: /create bot/i }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: `${name} menu` }).click({ timeout: 15_000 });
  await page.getByRole("menuitem", { name: "Bot settings" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("tab", { name: "Tools" }).click();

  const group = dialog.getByRole("radiogroup", { name: "Add a task permission" });
  await expect(group).toBeVisible({ timeout: 15_000 });
  const off = group.getByRole("radio", { name: "Off" });
  const ask = group.getByRole("radio", { name: "Ask" });

  await expect(ask).toHaveAttribute("data-state", "on");

  const [onBg, offBg] = await ask.evaluate((el) => {
    const on = getComputedStyle(el).backgroundColor;
    const sibling = el.parentElement!.querySelector('[data-state="off"]')!;
    return [on, getComputedStyle(sibling).backgroundColor];
  });
  expect(onBg).not.toBe(offBg);

  await off.click();
  await expect(off).toHaveAttribute("data-state", "on");
  await expect(ask).toHaveAttribute("data-state", "off");
});
