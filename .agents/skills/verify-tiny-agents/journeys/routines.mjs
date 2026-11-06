// Feature: routines (features/routines.md). Editor preview, paused routine, Run now, quiet chat line.
import { journey, expect } from "../scripts/lib.mjs";

await journey("routines", async ({ page, step, proof, cleanup, api, stamp }) => {
  const botName = `Routine Bot ${stamp}`;
  const name = `verify-routine-${stamp}`;
  let botId;
  let routineId;
  // A routine card has no landmark: anchor on its resume/pause switch.
  const card = () =>
    page
      .getByRole("switch", { name: new RegExp(`(resume|pause) ${name}`, "i") })
      .locator("xpath=ancestor::*[.//button[normalize-space()='Run now']][1]");

  await step("setup: a faux bot to own the routine (API)", async () => {
    const models = await api.get("/models");
    const bot = await api.post("/bots", { name: botName, modelId: models.defaultModel });
    botId = bot.id;
    cleanup(() => api.delete(`/bots/${botId}`));
  });
  await step("editor shows schedule sentence and next 3 runs before saving", async () => {
    await page.goto("/routines");
    await expect(page.getByRole("heading", { name: "Routines" })).toBeVisible();
    await page
      .getByRole("button", { name: /new routine/i })
      .first()
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("combobox", { name: "Bot" }).click();
    await page.getByRole("option", { name: botName }).click();
    await dialog.getByLabel("Name").fill(name);
    await dialog.getByLabel("Prompt").fill("say the thing");
    await dialog.getByRole("tab", { name: "Interval" }).click();
    await dialog.getByLabel(/interval minutes/i).fill("15");
    await expect(dialog.getByText("Every 15 minutes", { exact: true })).toBeVisible();
    await expect(dialog.getByText(/, \d{2}:\d{2} IST/)).toHaveCount(3);
  });
  await proof("editor-preview");
  await step("cancel the editor (saving would arm a queued fire)", async () => {
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
  });
  await step("setup: the routine, paused (API), shows on the page as Paused", async () => {
    const routine = await api.post("/routines", {
      botId,
      name,
      prompt: "say the thing",
      schedule: { kind: "interval", minutes: 15 },
      enabled: false,
    });
    routineId = routine.id;
    cleanup(() => api.delete(`/routines/${routineId}`));
    await page.reload();
    await expect(card()).toBeVisible();
    await expect(card().getByText(`${botName} · Every 15 minutes`)).toBeVisible();
    await expect(card().getByText("Paused", { exact: true })).toBeVisible();
  });
  await step("Run now records a manual execution", async () => {
    await card()
      .getByRole("button", { name: /run now/i })
      .click();
    const executions = page.getByRole("list").filter({ hasText: "manual" });
    await expect(executions.getByText(name).first()).toBeVisible({ timeout: 30_000 });
    await expect(executions.getByText(/succeeded|awaiting/).first()).toBeVisible({
      timeout: 30_000,
    });
    const { runs } = await api.get(`/routines/${routineId}/runs`);
    expect(runs.length, "a run row exists in GET /routines/:id/runs").toBeGreaterThan(0);
  });
  await proof("run-now");
  await step("bot chat shows only a quiet result line", async () => {
    await page.goto(`/chats/${botId}`);
    const line = page.getByTestId("routine-runs").filter({ hasText: name });
    await expect(line).toBeVisible({ timeout: 30_000 });
    await expect(line.getByRole("button")).toContainText("done");
    await expect(page.getByText(`**Routine "${name}"`)).toHaveCount(0);
  });
  await proof("chat-line");
});
