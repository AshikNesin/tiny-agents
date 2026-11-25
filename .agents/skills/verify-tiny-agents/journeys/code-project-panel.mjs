// Feature: code (features/code.md). The project chat's side panel: the project's
// threads grouped by state with a search box and PR chips, a thread opened inside the
// panel with its live transcript and a steer composer, the Context tab, and on a phone
// the panel as a full-screen view (`ta-verify up --demo-agent --fake-github`).
// TA_VERIFY_BEFORE=1 takes the plain project chat shots only.
import { devices } from "@playwright/test";
import { journey, expect, login } from "../scripts/lib.mjs";

const LOADED = { waitUntil: "domcontentloaded" };
const OUT = process.env.TA_VERIFY_SHOTS;
const BEFORE = process.env.TA_VERIFY_BEFORE === "1";

await journey("code-project-panel", async ({ page, step, proof, cleanup, api, stamp }) => {
  let project;
  const threads = [];
  const shot = async (p, label) => {
    if (OUT) await p.screenshot({ path: `${OUT}/${label}.png` });
  };

  await step("setup: a project with threads in several states, one with a PR", async () => {
    project = await api.post("/code/projects", {
      repo: "acme/web",
      name: `web-${stamp}`,
      defaultInstanceId: "demo",
    });
    cleanup(() => api.delete(`/code/projects/${project.id}`));
    await api.patch(`/code/projects/${project.id}`, {
      settings: { instructions: "Merge finished work to main once CI is green." },
    });
    for (const message of [
      "Fix the Safari export button, commit it",
      "Add a dark mode toggle, ask me first",
      "Speed up the search page",
    ]) {
      const id = (
        await api.post("/code/threads", { instanceId: "demo", projectId: project.id, message })
      ).threadId;
      cleanup(() => api.delete(`/code/threads/${encodeURIComponent(id)}`));
      threads.push(id);
    }
    await expect
      .poll(
        async () => {
          const rows = await api.get("/code/threads");
          return threads.every(
            (id, i) => i === 1 || rows.find((t) => t.id === id)?.working === false,
          );
        },
        { timeout: 60_000 },
      )
      .toBe(true);
    await api.post(`/code/threads/${encodeURIComponent(threads[0])}/publish`, {});
  });

  const panel = (p) => p.getByRole("complementary", { name: "Project panel" });

  await step("desktop: the project chat opens", async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/code/p/${encodeURIComponent(project.id)}`, LOADED);
    const box = page.getByPlaceholder(/^Message /);
    await expect(box).toBeVisible({ timeout: 20_000 });
    await box.fill("What's pending?");
    await box.press("Enter");
    await expect(page.getByText("Echo: What's pending?").first()).toBeVisible({ timeout: 30_000 });
  });
  await shot(page, "desktop-project-chat");
  if (BEFORE) {
    const context = await page
      .context()
      .browser()
      .newContext({ ...devices["iPhone 13"], baseURL: process.env.TA_VERIFY_URL });
    cleanup(() => context.close());
    const phone = await context.newPage();
    await step("phone: the project chat", async () => {
      await login(phone);
      await phone.goto(`/code/p/${encodeURIComponent(project.id)}`, LOADED);
      await expect(phone.getByPlaceholder(/^Message /)).toBeVisible({ timeout: 20_000 });
    });
    await shot(phone, "phone-project-chat");
    return;
  }

  await step("desktop: the panel lists the project's threads by state", async () => {
    await expect(panel(page)).toBeVisible();
    await expect(panel(page).locator(`[data-thread="${threads[1]}"]`)).toBeVisible({
      timeout: 20_000,
    });
    await expect(panel(page).getByRole("region", { name: "Needs you" })).toBeVisible();
    await expect(panel(page).locator(`[data-thread="${threads[0]}"]`)).toContainText("#");
  });
  await proof("panel-threads");
  await shot(page, "desktop-panel-threads");

  await step("desktop: search narrows the list", async () => {
    await panel(page).getByRole("searchbox", { name: "Search threads" }).fill("safari");
    await expect(panel(page).locator("[data-thread]")).toHaveCount(1);
    await panel(page).getByRole("searchbox", { name: "Search threads" }).fill("");
  });

  await step("desktop: a thread opens inside the panel", async () => {
    await panel(page).locator(`[data-thread="${threads[0]}"]`).click();
    await expect(page).toHaveURL(new RegExp(`thread=${encodeURIComponent(threads[0])}`));
    await expect(panel(page).getByTestId("code-transcript")).toBeVisible({ timeout: 20_000 });
    await expect(panel(page).getByTestId("project-panel-pr")).toBeVisible();
    await expect(panel(page).getByRole("textbox", { name: "Message Demo agent" })).toBeVisible();
  });
  await proof("panel-thread");
  await shot(page, "desktop-panel-thread");

  await step("desktop: steering the thread from the panel sends a turn", async () => {
    const box = panel(page).getByRole("textbox", { name: "Message Demo agent" });
    await box.fill(`Also note it in the changelog ${stamp}`);
    await box.press("Enter");
    await expect(
      panel(page)
        .getByTestId("code-transcript")
        .getByText(`Also note it in the changelog ${stamp}`),
    ).toBeVisible({ timeout: 20_000 });
  });

  await step("desktop: back returns to the list, Context shows the instructions", async () => {
    await panel(page).getByRole("button", { name: "Back to threads" }).click();
    await expect(panel(page).locator(`[data-thread="${threads[2]}"]`)).toBeVisible();
    await panel(page).getByRole("tab", { name: "Context" }).click();
    await expect(
      panel(page).getByText("Merge finished work to main once CI is green."),
    ).toBeVisible();
  });
  await proof("panel-context");
  await shot(page, "desktop-panel-context");
  await panel(page).getByRole("tab", { name: "Threads" }).click();

  const context = await page
    .context()
    .browser()
    .newContext({ ...devices["iPhone 13"], baseURL: process.env.TA_VERIFY_URL });
  cleanup(() => context.close());
  await context.route("https://feedbackbee.nesin.io/**", (route) => route.abort());
  const phone = await context.newPage();

  await step("phone: the project chat starts on the chat", async () => {
    await login(phone);
    await phone.goto(`/code/p/${encodeURIComponent(project.id)}`, LOADED);
    await expect(phone.getByPlaceholder(/^Message /)).toBeVisible({ timeout: 20_000 });
    await expect(panel(phone)).toBeHidden();
  });
  await shot(phone, "phone-project-chat");

  await step("phone: Threads opens the panel full screen", async () => {
    await phone.getByRole("button", { name: /^Threads/ }).tap();
    await expect(panel(phone).locator(`[data-thread="${threads[1]}"]`)).toBeVisible({
      timeout: 20_000,
    });
    await expect(phone.getByPlaceholder(/^Message /)).toBeHidden();
  });
  await shot(phone, "phone-panel-threads");

  await step("phone: a thread opens full screen", async () => {
    await panel(phone).locator(`[data-thread="${threads[0]}"]`).tap();
    await expect(panel(phone).getByTestId("code-transcript")).toBeVisible({ timeout: 20_000 });
  });
  await shot(phone, "phone-panel-thread");

  await step("phone: closing the panel returns to the chat", async () => {
    await panel(phone).getByRole("button", { name: "Back to threads" }).tap();
    await panel(phone).getByRole("button", { name: "Close the panel" }).tap();
    await expect(phone.getByPlaceholder(/^Message /)).toBeVisible();
  });
});
