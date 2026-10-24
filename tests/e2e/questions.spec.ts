import { test, expect, type Page } from "@playwright/test";
import { login } from "./helpers/login";

/**
 * A bot's questions for the owner (ask_owner), on the faux model: "/ask"
 * makes the bot ask a single-choice, a multiple-choice and an open question,
 * and it echoes the tool result it gets back.
 */

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

test.describe("Questions for the owner", () => {
  // The faux model streams slowly (playwright.config), and each test waits on two replies.
  test.setTimeout(90_000);

  test("the bot waits for the answers and goes on with them, across a reload", async ({ page }) => {
    await login(page);
    const name = `Asker ${Date.now()}`;
    await createBot(page, name);

    const composer = page.getByPlaceholder(new RegExp(`message ${name}`, "i"));
    await composer.fill("/ask set up the project");
    await composer.press("Enter");

    const card = page.getByTestId("question-card");
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card.getByText(`${name} has 3 questions for you`)).toBeVisible();
    // The sidebar shows the bot is waiting on the owner.
    await expect(page.getByLabel("1 question for you")).toBeVisible();

    // A reload keeps the questions waiting.
    await page.reload();
    await expect(card).toBeVisible({ timeout: 15_000 });

    await card.getByRole("radio", { name: /React/ }).check();
    await card.getByRole("button", { name: "Next" }).click();
    await card.getByRole("checkbox", { name: "Auth" }).check();
    await card.getByRole("checkbox", { name: "Tests" }).check();
    await card.getByRole("button", { name: "Next" }).click();
    await card
      .getByRole("textbox", { name: "Anything else I should know?" })
      .fill("Ship it Friday");
    await card.getByRole("button", { name: "Send answers" }).click();

    await expect(card).not.toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Echo: The owner answered your questions/).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(/A: React/).first()).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: /Asked you 3 questions/ }).click();
    await expect(page.getByText("Ship it Friday", { exact: true })).toBeVisible();
    await expect(page.getByLabel("1 question for you")).not.toBeVisible();
  });

  test("writing in the chat instead dismisses the questions", async ({ page }) => {
    await login(page);
    const name = `Dismisser ${Date.now()}`;
    await createBot(page, name);

    const composer = page.getByPlaceholder(new RegExp(`message ${name}`, "i"));
    await composer.fill("/ask");
    await composer.press("Enter");
    const card = page.getByTestId("question-card");
    await expect(card).toBeVisible({ timeout: 30_000 });

    await composer.fill("Just use React");
    await composer.press("Enter");
    await expect(card).not.toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("dismissed by you")).toBeVisible();
    await expect(page.getByText("Echo: Just use React").first()).toBeVisible({ timeout: 30_000 });
  });
});
