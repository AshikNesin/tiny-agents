import { devices } from "@playwright/test";
import { journey, expect, login } from "../scripts/lib.mjs";

const LOADED = { waitUntil: "domcontentloaded" };

await journey(
  "code-phone",
  async ({ page: desktop, step, cleanup, api, stamp }) => {
    const context = await desktop
      .context()
      .browser()
      .newContext({ ...devices["iPhone 13"], baseURL: process.env.TA_VERIFY_URL });
    cleanup(() => context.close());
    await context.route("https://feedbackbee.nesin.io/**", (route) => route.abort());
    const page = await context.newPage();
    const dir = `${process.env.TA_VERIFY_EVIDENCE}/code-phone`;
    const proof = (label) => page.screenshot({ path: `${dir}/${label}.png` });
    const noKeyHints = () => expect(page.locator("kbd:visible")).toHaveCount(0);
    let thread;

    await step("setup: a project thread with a long branch name", async () => {
      const project = await api.post("/code/projects", {
        repo: "acme/web",
        name: `web-${stamp}`,
        defaultInstanceId: "demo",
      });
      cleanup(() => api.delete(`/code/projects/${project.id}`));
      thread = (
        await api.post("/code/threads", {
          instanceId: "demo",
          projectId: project.id,
          message: `Write the changelog for the next version of the release notes page ${stamp}`,
        })
      ).threadId;
      cleanup(() => api.delete(`/code/threads/${encodeURIComponent(thread)}`));
      await expect
        .poll(async () => (await api.get("/code/threads")).find((t) => t.id === thread)?.working, {
          timeout: 30_000,
        })
        .toBe(false);
      await login(page);
    });

    await step("the list and the new thread box show no key hints", async () => {
      await page.goto("/code", LOADED);
      await expect(page.locator(`[data-thread="${thread}"]`)).toBeVisible({ timeout: 20_000 });
      await noKeyHints();
      await page
        .getByRole("button", { name: /New thread/ })
        .first()
        .tap();
      await expect(page.getByTestId("code-new-message")).toBeVisible();
      await noKeyHints();
      await expect(page.getByText("new line")).toBeHidden();
    });
    await proof("new-thread");

    await step(
      "the thread's branch line stays on screen; next steps show no key hints",
      async () => {
        await page.goto(`/code/t/${encodeURIComponent(thread)}`, LOADED);
        const branch = page.getByLabel("Branch");
        await expect(branch).toBeVisible({ timeout: 20_000 });
        const box = await branch.boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize().width);
        await expect(page.getByTestId("code-next-steps")).toBeVisible({ timeout: 20_000 });
        await noKeyHints();
      },
    );
    await proof("thread");

    await step("the work pane's tabs fit on one line beside the close button", async () => {
      await page.getByRole("button", { name: "Review changes" }).tap();
      const tabs = page.getByRole("tablist", { name: "Work pane" }).getByRole("tab");
      await expect(tabs.first()).toBeVisible({ timeout: 20_000 });
      const heights = await tabs.evaluateAll((all) => all.map((t) => t.scrollHeight));
      for (const h of heights) expect(h).toBeLessThanOrEqual(32);
      const last = await tabs.last().boundingBox();
      const close = await page.getByRole("button", { name: "Close the work pane" }).boundingBox();
      expect(last.x + last.width).toBeLessThanOrEqual(close.x);
      await noKeyHints();
    });
    await proof("pane");

    await step("the Files tab has no key hints", async () => {
      await page.getByRole("tab", { name: /Files/ }).tap();
      await expect(page.getByText("Pick a file to read or edit it.")).toBeVisible();
      await noKeyHints();
      await expect(page.getByText("finds a file by name")).toBeHidden();
    });
    await proof("files");
  },
  { requires: ["demo-agent", "fake-github"] },
);
