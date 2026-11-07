// Feature: questions (features/questions.md). "/ask" makes the faux bot ask a
// single-choice, a multiple-choice and an open question. Answer them (with a
// reload while they wait), skip one, dismiss them, and dismiss by writing in the chat.
import { journey, expect } from "../scripts/lib.mjs";

await journey("questions", async ({ page, step, proof, cleanup, api, stamp }) => {
  const name = `Ask Bot ${stamp}`;
  const composer = page.getByPlaceholder(`Message ${name}`);
  const card = page.getByTestId("question-card");
  const badge = page.getByLabel("1 question for you", { exact: true });
  const idle = () =>
    expect(page.getByRole("button", { name: "Send message" })).toBeVisible({ timeout: 60_000 });
  let botId;

  const ask = async () => {
    await idle();
    await composer.fill(`/ask ${stamp}`);
    await composer.press("Enter");
    await expect(card).toBeVisible({ timeout: 30_000 });
  };

  await step("setup: a bot of its own via the API", async () => {
    const { defaultModelId: defaultModel } = await api.get("/models");
    botId = (await api.post("/bots", { name, modelId: defaultModel })).id;
    cleanup(async () => {
      await api.delete(`/bots/${botId}`);
      expect((await api.get("/bots")).some((b) => b.id === botId)).toBe(false);
    });
    await page.goto(`/chats/${botId}`);
    await expect(composer).toBeVisible({ timeout: 15_000 });
  });

  await step("/ask shows the question card and a sidebar badge", async () => {
    await ask();
    await expect(card.getByText(`${name} has 3 questions for you`)).toBeVisible();
    await expect(card.getByText("Which stack should the project use?")).toBeVisible();
    await expect(badge).toBeVisible();
    expect((await api.get("/bots")).find((b) => b.id === botId)?.questions).toBe(1);
  });
  await proof("asked");

  await step("the questions survive a reload", async () => {
    await page.reload();
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.getByText("Which stack should the project use?")).toBeVisible();
  });

  await step("answer: single choice, multiple choice, open text, send", async () => {
    await card.getByRole("radio", { name: /React/ }).click();
    await expect(card.getByText("Question 2 of 3")).toBeVisible();
    await card.getByRole("checkbox", { name: /Auth/ }).click();
    await card.getByRole("checkbox", { name: /Tests/ }).click();
    await card.getByRole("button", { name: /Next/ }).click();
    await card
      .getByRole("textbox", { name: "Anything else I should know?" })
      .fill(`Ship it Friday ${stamp}`);
    await proof("answering");
    await card.getByRole("button", { name: /Send answers/ }).click();
    await expect(card).toHaveCount(0, { timeout: 15_000 });
  });

  await step("the bot goes on with the answers; they are echoed back", async () => {
    await expect(page.getByText(/Echo: The owner answered your questions/).first()).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByText(/A: React/).first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/A: Auth; Tests/).first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(new RegExp(`A: Ship it Friday ${stamp}`)).first()).toBeVisible({
      timeout: 60_000,
    });
    await expect(badge).toHaveCount(0);
  });

  await step("the answered card collapses to 'Asked you 3 questions'", async () => {
    await page.getByRole("button", { name: /Asked you 3 questions/ }).click();
    await expect(page.getByText(`Ship it Friday ${stamp}`, { exact: true })).toBeVisible();
    await expect(page.getByText("Auth, Tests", { exact: true })).toBeVisible();
  });
  await proof("answered");

  await step("Skip a question: the bot gets (skipped)", async () => {
    await ask();
    await card.getByRole("radio", { name: /Svelte/ }).click();
    await expect(card.getByText("Question 2 of 3")).toBeVisible();
    await card.getByRole("button", { name: /Skip/ }).click();
    await expect(card.getByText("Question 3 of 3")).toBeVisible();
    await card.getByRole("textbox", { name: "Anything else I should know?" }).fill(`skip ${stamp}`);
    await card.getByRole("button", { name: /Send answers/ }).click();
    await expect(card).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByText(/A: \(skipped\)/).first()).toBeVisible({ timeout: 60_000 });
  });

  await step("Dismiss: the bot goes on without answers", async () => {
    await ask();
    await card.getByRole("button", { name: "Dismiss" }).click();
    await expect(card).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByText(/Echo: The owner dismissed these questions/).first()).toBeVisible({
      timeout: 60_000,
    });
  });
  await proof("dismissed");

  await step("writing in the chat instead dismisses them", async () => {
    await ask();
    await composer.fill(`Just use React ${stamp}`);
    await composer.press("Enter");
    await expect(card).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByText("dismissed by you").first()).toBeVisible();
    await expect(page.getByText(`Echo: Just use React ${stamp}`).first()).toBeVisible({
      timeout: 60_000,
    });
    await expect(badge).toHaveCount(0);
  });
  await proof("chat-dismissed");
});
