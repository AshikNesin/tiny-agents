import { test, expect, type Page } from "@playwright/test";
import { login } from "./helpers/login";

/**
 * The Browser panel on a phone: it never opens on its own. The bot browsing
 * lights the header toggle, which opens it; picture in picture floats it
 * small over the chat, and the toggle reopens it that way after a reload.
 * On the faux model, "/browse N" reads the page N times (browser_snapshot).
 */

const PHONE = { width: 390, height: 844 };

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

async function browse(page: Page, name: string, rounds: number) {
  const composer = page.getByPlaceholder(new RegExp(`message ${name}`, "i"));
  await composer.fill(`/browse ${rounds}`);
  await composer.press("Enter");
}

/** Every reply so far has finished: each ends by echoing its last snapshot. */
async function settled(page: Page, replies: number) {
  await expect(page.getByText(/^Echo:/)).toHaveCount(replies, { timeout: 60_000 });
}

test.describe("Browser panel on mobile", () => {
  // Each reply streams slowly and drives a real (headless) browser.
  test.setTimeout(240_000);

  test("browsing never opens it; picture in picture is remembered", async ({ page }) => {
    await login(page);
    const name = `Browser ${Date.now()}`;
    await createBot(page, name);
    await page.setViewportSize(PHONE);

    const panel = page.getByTestId("browser-panel");
    const toggle = page.getByTestId("live-view-toggle");
    await expect(toggle).toBeVisible();

    // The bot browsing leaves the chat in view.
    await browse(page, name, 2);
    await settled(page, 1);
    await expect(panel).not.toBeVisible();

    // The owner opens it from the header, and shrinks it.
    await toggle.click();
    await expect(panel).toBeVisible();
    await panel.getByRole("button", { name: "Picture in picture" }).click();
    await expect(panel).toHaveAttribute("data-layout", "pip");
    const box = await panel.boundingBox();
    expect(box?.width ?? PHONE.width).toBeLessThan(PHONE.width - 50);

    // After a reload, browsing still leaves it closed, and the toggle
    // brings back the picture in picture.
    await page.reload();
    await settled(page, 1);
    await browse(page, name, 1);
    await settled(page, 2);
    await expect(panel).not.toBeVisible();
    await toggle.click();
    await expect(panel).toHaveAttribute("data-layout", "pip");
    await panel.getByRole("button", { name: "Close browser panel" }).click();
    await expect(panel).not.toBeVisible();
  });
});
