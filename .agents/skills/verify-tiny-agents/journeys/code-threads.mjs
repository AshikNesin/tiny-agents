// Feature: code (features/code.md). How threads are found from anywhere: the chat
// sidebar lists the threads that need you or still work, a row opens the thread, All
// threads opens Code, and on a phone the drawer shows them and the project chat's menu
// button leads back to the list (`ta-verify up --demo-agent --fake-github`).
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
        await api.post("/code/threads", { instanceId: "demo", projectId: projects[i].id, message })
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

  const inChat = (p) => p.getByRole("region", { name: "Threads" });

  await step("desktop: the chat sidebar lists the threads that need you", async () => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/chats", LOADED);
    const row = inChat(page).locator(`[data-thread="${threads[1]}"]`);
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row).toContainText("asks you");
    await expect(inChat(page).locator("[data-thread]")).toHaveCount(5);
  });
  await proof("desktop-chat");
  await shot(page, "desktop-chat");

  await step("desktop: a thread there opens in Code", async () => {
    await inChat(page).locator(`[data-thread="${threads[0]}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/code/t/${threads[0]}$`));
    await expect(page.getByLabel("Branch")).toBeVisible({ timeout: 20_000 });
  });
  await proof("desktop-thread");
  await shot(page, "desktop-thread");

  await step("desktop: All threads opens the Code list", async () => {
    await page.goto("/chats", LOADED);
    await inChat(page)
      .getByRole("link", { name: /All threads/ })
      .click();
    await expect(page).toHaveURL(/\/code$/);
    await expect(page.locator(`[data-thread="${threads[2]}"]`)).toBeVisible({ timeout: 20_000 });
  });
  await proof("desktop-home");
  await shot(page, "desktop-home");

  const context = await page
    .context()
    .browser()
    .newContext({ ...devices["iPhone 13"], baseURL: process.env.TA_VERIFY_URL });
  cleanup(() => context.close());
  await context.route("https://feedbackbee.nesin.io/**", (route) => route.abort());
  const phone = await context.newPage();

  await step("phone: the chat drawer lists the threads", async () => {
    await login(phone);
    await phone.goto("/chats", LOADED);
    await phone.getByRole("button", { name: "Open menu" }).first().tap();
    await expect(inChat(phone).locator(`[data-thread="${threads[1]}"]`)).toBeVisible({
      timeout: 20_000,
    });
    const drawer = phone.getByRole("complementary", { name: "Sidebar" });
    await expect.poll(async () => (await drawer.boundingBox())?.x).toBe(0);
  });
  await shot(phone, "phone-chat-drawer");

  await step(
    "phone: the project chat's menu button opens the chat drawer, like a bot chat",
    async () => {
      await phone.goto(`/code/p/${encodeURIComponent(projects[0].id)}`, LOADED);
      await expect(phone).toHaveURL(/\/chats\//, { timeout: 20_000 });
      await phone.getByRole("button", { name: "Open menu" }).tap();
      const drawer = phone.getByRole("complementary", { name: "Sidebar" });
      await expect.poll(async () => (await drawer.boundingBox())?.x).toBe(0);
      await expect(drawer.getByRole("region", { name: "Projects" })).toBeVisible();
    },
  );
  await shot(phone, "phone-project-drawer");
});
