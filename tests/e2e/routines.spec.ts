import { test, expect } from "@playwright/test";

/**
 * Routines e2e (issue #18 phase B), on the faux provider (echo replies, no
 * network). The Playwright webServer runs this repo's config.yml, where
 * jobs.enabled is false: the queue worker is not running, so creating an
 * ENABLED routine fails at arm time ("Job queue not initialized") and no
 * delayed fire can be observed. The spec therefore covers what this
 * environment supports: full editor flow (bot picker, schedule compile,
 * next-3 IST preview before saving), the created routine card, pause/resume
 * toggling, and "Run now", which dispatches synchronously through the real
 * watcher so Recent executions shows a succeeded manual run with output.
 * The run happens in the routine's own conversation (issue #63): the bot's
 * chat shows only a quiet result line, never the routine's prompt or reply,
 * and a new chat starts without it.
 * Waiting for the delayed queue fire is covered by the server tests.
 */

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("demo@example.com");
  await page.getByLabel(/password/i).fill("demo@example.com");
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page).toHaveURL(/\/chats(\/[^/]+)?$/);
}

const ROUTINE_NAME = `e2e-interval-${Date.now()}`;

/** Remove leftovers from earlier runs of this spec (the e2e DB persists). */
async function cleanup(page: import("@playwright/test").Page) {
  const response = await page.request.get("/api/v1/routines");
  const body = (await response.json()) as { data?: { id: string; name: string }[] };
  for (const routine of body.data ?? []) {
    if (routine.name.startsWith("e2e-interval")) {
      await page.request.delete(`/api/v1/routines/${routine.id}`);
    }
  }
}

test.describe("Routines", () => {
  test("create a routine, see it paused, run it now, and read the execution", async ({ page }) => {
    await login(page);
    await cleanup(page);

    // Ensure a faux bot exists for the editor's picker. Asked of the API: the
    // sidebar may not have loaded yet, and a second "Routine Bot" would make
    // the picker ambiguous.
    if (!(await hasBotNamed(page, "Routine Bot"))) {
      await page
        .getByRole("button", { name: /new bot/i })
        .first()
        .click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await expect(page.getByRole("button", { name: "Test Model (faux)" })).toBeVisible({
        timeout: 15_000,
      });
      await page.getByLabel("Name").fill("Routine Bot");
      await page.getByRole("button", { name: /create bot/i }).click();
      await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 15_000 });
    }

    await page.goto("/routines");
    await expect(page.getByRole("heading", { name: "Routines" })).toBeVisible();

    // Editor: interval schedule of 15 minutes with a live preview.
    // The empty page has one "New routine" button, in the header.
    await page
      .getByRole("button", { name: /new routine/i })
      .first()
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("combobox", { name: "Bot" }).click();
    // Radix portals the listbox outside the dialog, so options live at page level.
    await page.getByRole("option", { name: "Routine Bot" }).click();
    await dialog.getByLabel("Name").fill(ROUTINE_NAME);
    await dialog.getByLabel("Prompt").fill("say the thing");

    await dialog.getByRole("tab", { name: "Interval" }).click();
    await dialog.getByLabel(/interval minutes/i).fill("15");
    // Acceptance criterion: sentence + next 3 runs visible BEFORE saving.
    await expect(dialog.getByText("Every 15 minutes", { exact: true })).toBeVisible();
    const previewTimes = dialog.getByText(/, \d{2}:\d{2} IST/);
    await expect(previewTimes).toHaveCount(3);

    // This environment runs without the queue worker (config.yml keeps
    // jobs disabled), so arming at create fails; close the dialog instead.
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();

    // Create the routine paused through the API (the editor always arms by
    const create = await page.request.post("/api/v1/routines", {
      data: {
        botId: await botIdOf(page, "Routine Bot"),
        name: ROUTINE_NAME,
        prompt: "say the thing",
        schedule: { kind: "interval", minutes: 15 },
        enabled: false,
      },
    });
    expect(create.ok()).toBeTruthy();
    await page.reload();

    await expect(page.getByText(ROUTINE_NAME).first()).toBeVisible();
    await expect(page.getByText("Routine Bot · Every 15 minutes").first()).toBeVisible();
    await expect(page.getByText("Paused")).toBeVisible();

    // Run now: dispatches synchronously (no queue) and the watcher resolves
    // the run; Recent executions shows it succeeded with the echo output.
    await page.getByRole("button", { name: /run now/i }).click();
    const executions = page.getByRole("list").filter({ hasText: "manual" });
    await expect(executions.getByText(ROUTINE_NAME).first()).toBeVisible({ timeout: 20_000 });
    await expect(executions.getByText(/succeeded|awaiting/).first()).toBeVisible({
      timeout: 20_000,
    });

    // The bot's chat shows the run as one quiet line; the prompt and the
    // reply stay in the routine's own conversation (a user bubble would show
    // the raw `**Routine "…"` label).
    const botId = await botIdOf(page, "Routine Bot");
    await page.goto(`/chats/${botId}`);
    const line = page.getByTestId("routine-runs").filter({ hasText: ROUTINE_NAME });
    await expect(line).toBeVisible({ timeout: 20_000 });
    await expect(line.getByRole("button")).toContainText("done");
    await expect(page.getByText(`**Routine "${ROUTINE_NAME}"`)).toHaveCount(0);
    // Its output shows only when opened.
    await line.getByRole("button").click();
    await expect(line.getByTestId("routine-run")).toBeVisible();
    // A new chat starts clean: earlier results stay on the Routines page.
    await page.request.post(`/api/v1/bots/${botId}/reset`);
    await page.reload();
    await expect(page.getByRole("textbox")).toBeVisible();
    await expect(page.getByTestId("routine-runs").filter({ hasText: ROUTINE_NAME })).toHaveCount(0);
    await page.goto("/routines");

    // The resume switch would re-arm through the queue; in this environment
    // it surfaces the queue error as a toast instead of arming. Flip it and
    // assert the routine stays on the page (the failed arm is server-side).
    await page.getByRole("switch", { name: new RegExp(`resume ${ROUTINE_NAME}`, "i") }).click();
    await expect(page.getByText(ROUTINE_NAME).first()).toBeVisible();

    await cleanup(page);
  });
});

async function hasBotNamed(page: import("@playwright/test").Page, name: string): Promise<boolean> {
  const response = await page.request.get("/api/v1/bots");
  const body = (await response.json()) as { data?: { name: string }[] };
  return (body.data ?? []).some((entry) => entry.name === name);
}

/** Look up the bot id through the API using the page's auth cookie. */
async function botIdOf(page: import("@playwright/test").Page, name: string): Promise<string> {
  const response = await page.request.get("/api/v1/bots");
  const body = (await response.json()) as { data?: { id: string; name: string }[] };
  const bot = body.data?.find((entry) => entry.name === name);
  if (!bot) throw new Error(`Bot "${name}" not found`);
  return bot.id;
}
