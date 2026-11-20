// Feature: code-pr (features/code-pr.md). A project thread's whole pull request life,
// against the fake GitHub of `ta-verify up --shelley --fake-github`: start a thread in a
// project (its own worktree and branch), commit, Publish draft PR, checks, the Draft and
// Auto-merge switches, a teammate's review, review mode from the PR tab, the Reviews
// inbox (Add project for a repository outside any project), Merge, and the thread after
// the merge archived it.
//
// The fake GitHub is the server tests' in-memory one: the workspace runs real git
// against a local bare repository, so Publish really pushes. A control server on
// port + 3 shapes the fake's PRs (checks, reviews, inbox).
import { journey, expect } from "../scripts/lib.mjs";

const CONTROL = `http://127.0.0.1:${Number(new URL(process.env.TA_VERIFY_URL).port) + 3}`;
const control = async (path, body) => {
  const res = await fetch(`${CONTROL}${path}`, {
    method: body === undefined ? "GET" : "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`fake GitHub control ${path}: ${res.status} ${await res.text()}`);
  return res.json();
};
const LOADED = { waitUntil: "domcontentloaded" };
const ago = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();
const check = (name, state, jobId) => ({
  name,
  state,
  startedAt: ago(5),
  completedAt: state === "pending" ? null : ago(1),
  url: null,
  jobId,
});

await journey(
  "code-pr",
  async ({ page, step, proof, cleanup, api, stamp }) => {
    let project;
    let threadId;
    let number;
    const composer = page.getByRole("textbox", { name: "Message Shelley" });
    const prTab = page.getByTestId("code-pr");
    const threadPath = (suffix = "") => `/code/${encodeURIComponent(threadId)}${suffix}`;

    await step("setup: a project on the fake acme/web", async () => {
      const { harnesses } = await api.get("/code/status");
      project = await api.post("/code/projects", {
        repo: "acme/web",
        name: `web-${stamp}`,
        defaultInstanceId: harnesses[0].id,
      });
      cleanup(() => api.delete(`/code/projects/${project.id}`));
      cleanup(async () => {
        for (const view of ["", "?view=archived"]) {
          for (const t of await api.get(`/code/threads${view}`)) {
            if (t.projectId === project.id)
              await api.delete(`/code/threads/${encodeURIComponent(t.id)}`);
          }
        }
      });
    });

    await step("start a thread in the project: its own branch", async () => {
      await page.goto(`/code/new?project=${project.id}`, LOADED);
      await expect(composer).toBeVisible({ timeout: 20_000 });
      await composer.fill(`echo: start-${stamp}`);
      await composer.press("Enter");
      await page.waitForURL(/\/code\/shelley/, { timeout: 30_000 });
      threadId = decodeURIComponent(new URL(page.url()).pathname.split("/").pop());
      await expect(page.getByText(/ta\/[a-z0-9-]+ from main/)).toBeVisible({ timeout: 20_000 });
    });
    await proof("thread");

    await step("commit, then the PR tab offers Publish", async () => {
      // The project preamble prefixes the first message, so `bash:` works from the second.
      await composer.fill(
        `bash: printf 'export const b = 2;\\n' > src/b.ts && git add src/b.ts && git -c user.email=v@example.com -c user.name=v commit -qm 'Add b ${stamp}'`,
      );
      await composer.press("Enter");
      // The branch, not the worktree's full path (#404).
      await expect(page.getByText(/^ta\/[a-z0-9-]+ now at [0-9a-f]{7}/)).toBeVisible({
        timeout: 30_000,
      });
      await page.goto(threadPath("/pr"), LOADED);
      await expect(prTab.getByText(/is 1 commit ahead of main/)).toBeVisible({ timeout: 20_000 });
      // No header repeating the tab's name before a PR exists (#384).
      await expect(prTab.getByText("Pull request", { exact: true })).toHaveCount(0);
    });
    await proof("pr-tab-before");

    await step("Publish draft PR: a draft on GitHub, nothing to act on yet", async () => {
      await page.getByTestId("code-publish").click();
      await expect(page.getByTestId("code-draft")).toBeChecked({ timeout: 20_000 });
      const { pulls } = await control("/state");
      number = pulls.at(-1).number;
      expect(pulls.at(-1).draft).toBe(true);
      await expect(prTab.getByRole("button", { name: "Merge" })).toBeDisabled();
      // The header shows the PR at once, not a second "Review" (#405).
      await expect(page.getByTestId("code-changes-toggle")).toContainText(`#${number}`, {
        timeout: 20_000,
      });
      // #384: no Fix, no empty Comments, no spend limit with Auto-fix off.
      await expect(prTab.getByRole("button", { name: "Fix", exact: true })).toHaveCount(0);
      await expect(prTab.getByRole("region", { name: "Comments" })).toHaveCount(0);
      await expect(prTab.getByText("Spend limit")).toHaveCount(0);
    });
    await proof("published");

    await step("checks: the failing one leads", async () => {
      await control(`/pulls/${number}`, {
        checks: [
          check("lint", "success", 11),
          check("test", "failure", 12),
          check("build", "pending", 13),
        ],
      });
      await prTab.getByRole("button", { name: "Refresh" }).click();
      await expect(prTab.getByText("1 failing check")).toBeVisible({ timeout: 20_000 });
    });
    await proof("checks");

    await step("Draft off, Auto-merge on: GitHub has both", async () => {
      await page.getByTestId("code-draft").click();
      await expect(page.getByTestId("code-draft")).not.toBeChecked({ timeout: 20_000 });
      // A failing check keeps Merge shut, and says so (#406).
      await expect(prTab.getByRole("button", { name: "Merge" })).toBeDisabled();
      await expect(prTab.getByText("Merge opens once checks pass.")).toBeVisible();
      await page.getByTestId("code-automerge").click();
      await expect(prTab.getByText("On at GitHub")).toBeVisible({ timeout: 20_000 });
      const pull = (await control("/state")).pulls.find((p) => p.number === number);
      expect([pull.draft, pull.autoMerge]).toEqual([false, true]);
    });

    await step("a teammate's review: no Ignored badge while Auto-fix is off (#385)", async () => {
      await control(`/pulls/${number}`, {
        reviews: [
          {
            id: "R_1",
            author: { login: "carol", type: "user" },
            state: "CHANGES_REQUESTED",
            body: `Split this ${stamp}`,
            submittedAt: ago(2),
            commit: null,
          },
        ],
      });
      await prTab.getByRole("button", { name: "Refresh" }).click();
      const comments = prTab.getByRole("region", { name: "Comments" });
      await expect(comments).toContainText(`Split this ${stamp}`, { timeout: 20_000 });
      await expect(comments).not.toContainText("Ignored");
      await expect(comments).not.toContainText("Auto-fix skips");
    });
    await proof("review-comment");

    await step("Review on the PR tab opens review mode on the PR's changes", async () => {
      await prTab.getByRole("button", { name: "Review", exact: true }).click();
      await page.waitForURL(/\/code\/reviews\//, { timeout: 30_000 });
      await expect(page.getByText("b.ts").first()).toBeVisible({ timeout: 30_000 });
    });
    await proof("review-mode");

    await step("Reviews inbox: a PR outside any project offers Add project (#386)", async () => {
      const now = new Date().toISOString();
      await control("/inbox", [
        {
          reason: "reviewed",
          repo: { owner: "acme", name: "api" },
          number: 12,
          title: `Cache the session lookups ${stamp}`,
          url: "https://github.com/acme/api/pull/12",
          author: "li",
          draft: false,
          updatedAt: now,
          headSha: "b".repeat(40),
          decision: "changes_requested",
          lastReview: { at: now, commit: "c".repeat(40) },
        },
      ]);
      await page.goto("/code/reviews", LOADED);
      await page
        .getByRole("link", { name: "Add acme/api as a project to review #12 here" })
        .click();
      await expect(page).toHaveURL(/\/code\/settings\/projects\?repo=acme%2Fapi$/);
      await expect(page.getByRole("textbox", { name: "Repository" })).toHaveValue("acme/api");
    });
    await proof("add-project");

    await step("checks green, Merge: the PR tab leads with Merged (#383)", async () => {
      await control(`/pulls/${number}`, {
        checks: [check("lint", "success", 11), check("test", "success", 12)],
      });
      await page.goto(threadPath("/pr"), LOADED);
      await prTab.getByRole("button", { name: "Merge" }).click();
      await page.getByRole("menuitem", { name: "Squash and merge" }).click();
      const merged = prTab.getByRole("region", { name: "Merged" });
      await expect(merged).toContainText(`#${number}`, { timeout: 30_000 });
      await expect(page.getByTestId("code-publish")).toHaveCount(0);
      expect((await control("/state")).merged).toContainEqual({ number, method: "squash" });
      // Archive on merge: the composer offers the way back.
      await expect(page.getByTestId("code-archived")).toBeVisible({ timeout: 20_000 });
    });
    await proof("merged");

    await step("Source control after the merge says where the worktree went", async () => {
      await page.getByRole("tab", { name: /Source control/ }).click();
      await expect(page.getByText(/Its worktree went when the thread was archived/)).toBeVisible({
        timeout: 20_000,
      });
    });
    await proof("merged-source");
  },
  { requires: ["shelley", "fake-github"] },
);
