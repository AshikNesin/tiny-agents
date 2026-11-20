import { test, expect, type Page } from "@playwright/test";
import { login } from "./helpers/login";

async function createBot(page: Page, name: string) {
  await page
    .getByRole("button", { name: /new bot|create your first bot/i })
    .first()
    .click();
  await expect(page.getByRole("button", { name: "Test Model (faux)" })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: /create bot/i }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 15_000 });
}

test.describe("YOLO mode", () => {
  test.setTimeout(90_000);

  test("runs tools without asking while on, and asks again once off", async ({ page }) => {
    await login(page);
    const name = `Yolo ${Date.now()}`;
    await createBot(page, name);

    const toggle = page.getByTestId("yolo-toggle");
    const expectYolo = async (on: boolean) => {
      await page.getByRole("button", { name: `${name} menu` }).click();
      await expect(toggle).toHaveAttribute("aria-checked", String(on));
      await page.keyboard.press("Escape");
      await expect(toggle).toHaveCount(0);
    };
    await expectYolo(false);
    await page.getByRole("button", { name: `${name} menu` }).click();
    await toggle.click();
    await page.getByRole("button", { name: "Turn on", exact: true }).click();
    await expect(page.getByTestId("yolo-banner")).toBeVisible();
    await expectYolo(true);

    await page.reload();
    await expect(page.getByTestId("yolo-banner")).toBeVisible({ timeout: 15_000 });

    const composer = page.getByPlaceholder(new RegExp(`message ${name}`, "i"));
    await composer.fill("/improve");
    await composer.press("Enter");
    await expect(page.getByText(/Echo: \/improve/).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/wants to update own instructions/)).not.toBeVisible();
    await expect(page.getByText(/auto-approved \(YOLO\)/).first()).toBeVisible();

    await page.getByTestId("yolo-banner").getByRole("button", { name: "Turn off" }).click();
    await expect(page.getByTestId("yolo-banner")).not.toBeVisible();
    await expectYolo(false);

    await composer.fill("/improve");
    await composer.press("Enter");
    await expect(page.getByText(/wants to update own instructions/)).toBeVisible({
      timeout: 30_000,
    });
  });
});
