import { test, expect } from "@playwright/test";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("demo@example.com");
  await page.getByLabel(/password/i).fill("demo@example.com");
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page).toHaveURL(/\/chats(\/[^/]+)?$/);
}

const ROUTINE_NAME = `e2e-interval-${Date.now()}`;

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

    await page
      .getByRole("button", { name: /new routine/i })
      .first()
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("combobox", { name: "Bot" }).click();
    await page.getByRole("option", { name: "Routine Bot" }).click();
    await dialog.getByLabel("Name").fill(ROUTINE_NAME);
    await dialog.getByLabel("Prompt").fill("say the thing");

    await dialog.getByRole("tab", { name: "Interval" }).click();
    await dialog.getByLabel(/interval minutes/i).fill("15");
    await expect(dialog.getByText("Every 15 minutes", { exact: true })).toBeVisible();
    const previewTimes = dialog.getByText(/, \d{2}:\d{2} IST/);
    await expect(previewTimes).toHaveCount(3);

    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();

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

    await page.getByRole("button", { name: /run now/i }).click();
    const executions = page.getByRole("list").filter({ hasText: "manual" });
    await expect(executions.getByText(ROUTINE_NAME).first()).toBeVisible({ timeout: 20_000 });
    await expect(executions.getByText(/succeeded|awaiting/).first()).toBeVisible({
      timeout: 20_000,
    });

    const botId = await botIdOf(page, "Routine Bot");
    await page.goto(`/chats/${botId}`);
    const line = page.getByTestId("routine-runs").filter({ hasText: ROUTINE_NAME });
    await expect(line).toBeVisible({ timeout: 20_000 });
    await expect(line.getByRole("button")).toContainText("succeeded");
    await expect(page.getByText(`**Routine "${ROUTINE_NAME}"`)).toHaveCount(0);
    await line.getByRole("button").click();
    await expect(line.getByTestId("routine-run")).toBeVisible();
    await page.request.post(`/api/v1/bots/${botId}/reset`);
    await page.reload();
    await expect(page.getByRole("textbox")).toBeVisible();
    await expect(page.getByTestId("routine-runs").filter({ hasText: ROUTINE_NAME })).toHaveCount(0);
    await page.goto("/routines");

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

async function botIdOf(page: import("@playwright/test").Page, name: string): Promise<string> {
  const response = await page.request.get("/api/v1/bots");
  const body = (await response.json()) as { data?: { id: string; name: string }[] };
  const bot = body.data?.find((entry) => entry.name === name);
  if (!bot) throw new Error(`Bot "${name}" not found`);
  return bot.id;
}
