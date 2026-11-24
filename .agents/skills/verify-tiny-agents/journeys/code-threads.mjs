// Feature: code (features/code.md). How a project's threads are found: the sidebar lists
// each project's threads under its name, the name opens the project chat, and on a phone
// the chat's menu button leads back to the list (`ta-verify up --demo-agent --fake-github`).
import { devices } from "@playwright/test";
import { journey, expect, login } from "../scripts/lib.mjs";

const LOADED = { waitUntil: "domcontentloaded" };
const OUT = process.env.TA_VERIFY_SHOTS;

await journey("code-threads", async ({ page, step, proof, cleanup, api, stamp }) => {
  const projects = [];
  const threads = [];
  const shot = async (p, label) => {
    if (OUT) await p.screenshot({ path: `${OUT}/${label}.png` });
  };

  await step("setup: two projects with threads in each", async () => {
    for (const name of ["web", "api"]) {
      const project = await api.post("/code/projects", {
        repo: `acme/${name}`,
        name: `${name}-${stamp}`,
        defaultInstanceId: "demo",
      });
      cleanup(() => api.delete(`/code/projects/${project.id}`));
      projects.push(project);
    }
    const asks = [
      [0, "Fix the Safari export button"],
      [0, "Add a dark mode toggle, ask me first"],
      [0, "Speed up the search page"],
      [1, "Rate limit the login route"],
      [1, "Write the changelog for 2.0"],
    ];
    for (const [i, message] of asks) {
      const id = (
        await api.post("/code/threads", {
          instanceId: "demo",
          projectId: projects[i].id,
          message,
        })
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
  });

  await step("desktop: the Code home lists each project's threads under it", async () => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/code", LOADED);
    const web = page.getByRole("region", { name: projects[0].name });
    await expect(web.locator(`[data-thread="${threads[0]}"]`)).toBeVisible({
      timeout: 20_000,
    });
    await expect(web.locator("[data-thread]")).toHaveCount(3);
  });
  await proof("desktop-home");
  await shot(page, "desktop-home");

  await step("desktop: the project's name opens its chat", async () => {
    await page.getByRole("link", { name: `${projects[0].name} chat` }).click();
    await expect(page).toHaveURL(new RegExp(`/code/p/${projects[0].id}$`));
    await expect(page.getByRole("textbox").first()).toBeVisible({
      timeout: 20_000,
    });
  });
  await proof("desktop-project-chat");
  await shot(page, "desktop-project-chat");

  await step("desktop: a thread", async () => {
    await page.goto(`/code/t/${encodeURIComponent(threads[0])}`, LOADED);
    await expect(page.getByLabel("Branch")).toBeVisible({ timeout: 20_000 });
  });
  await proof("desktop-thread");
  await shot(page, "desktop-thread");

  const context = await page
    .context()
    .browser()
    .newContext({
      ...devices["iPhone 13"],
      baseURL: process.env.TA_VERIFY_URL,
    });
  cleanup(() => context.close());
  await context.route("https://feedbackbee.nesin.io/**", (route) => route.abort());
  const phone = await context.newPage();

  await step("phone: the Code home", async () => {
    await login(phone);
    await phone.goto("/code", LOADED);
    await expect(phone.locator(`[data-thread="${threads[0]}"]`)).toBeVisible({
      timeout: 20_000,
    });
  });
  await shot(phone, "phone-home");

  await step("phone: a project chat", async () => {
    await phone.goto(`/code/p/${encodeURIComponent(projects[0].id)}`, LOADED);
    await expect(phone.getByRole("textbox").first()).toBeVisible({
      timeout: 20_000,
    });
  });
  await shot(phone, "phone-project-chat");

  await step("phone: the project chat's menu button goes back to the thread list", async () => {
    await phone.getByRole("button", { name: "Open menu" }).tap();
    await expect(phone).toHaveURL(/\/code$/);
    await expect(phone.locator(`[data-thread="${threads[0]}"]`)).toBeVisible();
  });

  await step("phone: a thread", async () => {
    await phone.goto(`/code/t/${encodeURIComponent(threads[0])}`, LOADED);
    await expect(phone.getByLabel("Branch")).toBeVisible({ timeout: 20_000 });
  });
  await shot(phone, "phone-thread");
});
