import { test, expect, type Page } from "@playwright/test";
import { login } from "./helpers/login";

/**
 * The Browser panel on a phone (friction #37 follow-up): it opens itself the
 * first time the bot drives its browser in a conversation, and once the owner
 * closes it, further browser calls (this run, the next, after a reload) leave
 * it closed and only light the header toggle. A new chat starts fresh.
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

  test("an explicit close sticks for the conversation", async ({ page }) => {
    await login(page);
    const name = `Browser ${Date.now()}`;
    await createBot(page, name);
    await page.setViewportSize(PHONE);

    const panel = page.getByTestId("browser-panel");
    // The header's live view button is the way back in on a phone too.
    const toggle = page.getByTestId("live-view-toggle");
    await expect(toggle).toBeVisible();

    // First browser use in this conversation: the panel opens over the chat.
    await browse(page, name, 3);
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await panel.getByRole("button", { name: "Close browser panel" }).click();
    await expect(panel).not.toBeVisible();

    // The rest of that run's browser calls leave it closed.
    await settled(page, 1);
    await expect(panel).not.toBeVisible();

    // So does the next run.
    await browse(page, name, 2);
    await settled(page, 2);
    await expect(panel).not.toBeVisible();

    // And a reload of the tab.
    await page.reload();
    await settled(page, 2);
    await browse(page, name, 1);
    await settled(page, 3);
    await expect(panel).not.toBeVisible();

    // The owner can still open it from the header.
    await toggle.click();
    await expect(panel).toBeVisible();
    await panel.getByRole("button", { name: "Close browser panel" }).click();
    await expect(panel).not.toBeVisible();

    // A new chat is a new conversation: the first browser use opens it again.
    await page.getByRole("button", { name: "Start a new chat" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "New chat" }).click();
    await settled(page, 0);
    await browse(page, name, 1);
    await expect(panel).toBeVisible({ timeout: 30_000 });
  });
});
