// Feature: code-comments (features/code-comments.md). Reviewing a thread's changes the
// way a reviewer does, on the keyless predictable Shelley (`ta-verify up --shelley`):
// the Changes panel folds unchanged runs ("Show N more lines"), a line's gutter offers
// Comment with a composer right under the line, the saved comment stays under its line
// and waits above the thread's composer, and the next message carries it to the agent.
//
// Shelley runs on the HOST: the thread works in a throwaway git repo under
// data/verify/<run>/work-<stamp>, removed with its threads.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { journey, expect } from "../scripts/lib.mjs";

const LOADED = { waitUntil: "domcontentloaded" };
const numbered = (count, change) =>
  Array.from({ length: count }, (_, i) =>
    i + 1 === change?.at ? change.text : `const line${i + 1} = ${i + 1};`,
  ).join("\n") + "\n";

await journey(
  "code-comments",
  async ({ page, step, proof, cleanup, api, stamp }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    const run = process.env.TA_VERIFY_RUN;
    const dir = path.join(process.cwd(), "data", "verify", run, `work-${stamp}`);
    const composer = page.getByRole("textbox", { name: "Message Shelley" });
    const transcript = page.getByRole("region", { name: "Messages" });
    const changes = page.getByTestId("code-changes");
    const tray = page.getByRole("region", { name: "Comments for the agent" });
    const ours = (t) => t.cwd === dir;
    const threads = async (view) =>
      (await api.get(`/code/threads${view ? `?view=${view}` : ""}`)).filter(ours);
    let id;

    await step(
      "setup: a repo with an uncommitted change in the middle of a long file",
      async () => {
        mkdirSync(path.join(dir, "src"), { recursive: true });
        cleanup(() => rmSync(dir, { recursive: true, force: true }));
        writeFileSync(path.join(dir, "src", "app.ts"), numbered(60));
        const git = (...args) =>
          execFileSync(
            "git",
            ["-c", "user.email=v@example.com", "-c", "user.name=verify", ...args],
            {
              cwd: dir,
              stdio: "ignore",
            },
          );
        git("init", "-q");
        git("add", ".");
        git("commit", "-qm", `init ${stamp}`);
        writeFileSync(
          path.join(dir, "src", "app.ts"),
          numbered(60, {
            at: 30,
            text: `const answer = computeTheAnswerToTheUltimateQuestionOfLifeTheUniverseAndEverything("${stamp}", { slowly: true, carefully: true });`,
          }),
        );
        cleanup(async () => {
          await expect
            .poll(
              async () => {
                const left = [...(await threads()), ...(await threads("archived"))];
                await Promise.all(
                  left.map((t) => api.delete(`/code/threads/${encodeURIComponent(t.id)}`)),
                );
                return left.length;
              },
              { timeout: 30_000, intervals: [2_000] },
            )
            .toBe(0);
        });
      },
    );

    await step("start a thread in the repo", async () => {
      await page.goto("/code/new", LOADED);
      await expect(composer).toBeVisible({ timeout: 20_000 });
      await page.getByRole("button", { name: "Working directory" }).click();
      await page.getByRole("combobox").fill(dir);
      await page.getByRole("combobox").press("Enter");
      await composer.fill(`echo: review-${stamp}`);
      await page.getByRole("button", { name: "Start" }).click();
      await expect(page).toHaveURL(/\/code\/shelley%3A/, { timeout: 20_000 });
      id = decodeURIComponent(new URL(page.url()).pathname.split("/").pop());
      await expect(transcript.getByText(`review-${stamp}`, { exact: true })).toBeVisible({
        timeout: 30_000,
      });
    });

    await step("Changes: the change with its context, the rest folded", async () => {
      await page.getByTestId("code-changes-toggle").click();
      await expect(changes.getByTestId("code-file")).toHaveCount(1, { timeout: 20_000 });
      await expect(changes.getByText(`"${stamp}"`, { exact: false })).toBeVisible();
      // diffs.com folds the unchanged runs around the change's context.
      await expect(changes.getByText("25 unmodified lines").first()).toBeVisible();
      await expect(changes.getByText("26 unmodified lines").first()).toBeVisible();
      await expect(changes.getByText("const line10 = 10;")).toHaveCount(0);
    });
    await proof("changes-folded");

    await step("Files opens the changed files as a tree over the column", async () => {
      await changes.getByRole("button", { name: "Files" }).click();
      const tree = changes.getByRole("navigation", { name: "Changed files" });
      await expect(tree.getByRole("treeitem", { name: /app\.ts/ })).toBeVisible();
      await expect(changes.getByRole("region", { name: "Diff stats" })).toContainText("Files1");
      await proof("changes-tree");
      await changes.getByRole("button", { name: "Close files" }).first().click();
      await expect(tree).toHaveCount(0);
    });

    await step("a line's gutter opens a composer right under the line", async () => {
      // The diff draws in a shadow root; Playwright's CSS reaches into it. Click line 30's number.
      await changes
        .locator(
          '[data-gutter] > [data-column-number="30"]:not([data-line-type="change-deletion"])',
        )
        .click();
      const box = changes.getByRole("textbox", { name: "Comment on src/app.ts line 30" });
      await expect(box).toBeFocused();
      await box.fill(`Split this call over several lines (${stamp})`);
    });
    await proof("composer-inline");

    await step("Comment saves it under its line and above the thread's composer", async () => {
      const saved = page.waitForResponse(
        (r) => r.request().method() === "POST" && r.url().endsWith("/review/drafts"),
      );
      await changes.getByRole("button", { name: "Comment", exact: true }).click();
      expect((await saved).status()).toBe(201);
      await expect(changes.getByRole("note", { name: "Comment on line 30" })).toContainText(
        `Split this call over several lines (${stamp})`,
      );
      await expect(tray).toContainText("1 comment goes with your next message");
      await tray.getByRole("button", { name: "Show comments" }).click();
      await expect(tray.getByText("src/app.ts:30")).toBeVisible();
      // A second view: the server keeps it for the thread.
      const drafts = await api.get(`/code/threads/${encodeURIComponent(id)}/review/drafts`);
      expect(drafts.map((d) => [d.path, d.startLine, d.side])).toEqual([["src/app.ts", 30, "new"]]);
    });
    await proof("comment-waiting");

    await step("the next message takes the comment to the agent", async () => {
      await composer.fill(`echo: thanks-${stamp}`);
      await composer.press("Enter");
      await expect(tray).toHaveCount(0, { timeout: 20_000 });
      // The thread shows it as a comment card, then the message that went with it.
      const card = transcript.getByRole("article").filter({ hasText: "src/app.ts:30" });
      await expect(card).toBeVisible({ timeout: 20_000 });
      await expect(card).toContainText(`Split this call over several lines (${stamp})`);
      await expect(transcript.getByText(`echo: thanks-${stamp}`, { exact: true })).toBeVisible();
      await expect(changes.getByRole("note")).toHaveCount(0);
      expect(await api.get(`/code/threads/${encodeURIComponent(id)}/review/drafts`)).toEqual([]);
    });
    await proof("comment-sent");

    await step("Open as a page: the Review page shows the changes full width", async () => {
      await page.getByRole("button", { name: "Open as a page" }).click();
      await expect(page).toHaveURL(/\/code\/shelley%3A[^/]+\/review$/);
      const review = page.getByTestId("code-review-page");
      await expect(review.getByRole("tab", { name: "Source control" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await expect(review.getByTestId("code-file")).toHaveCount(1);
      // The tree sits beside the column here.
      await expect(
        review
          .getByRole("navigation", { name: "Changed files" })
          .getByRole("treeitem", { name: /app\.ts/ }),
      ).toBeVisible();
      await expect(transcript).toHaveCount(0);
      // Comments work here too, and wait in the tray at the bottom.
      await review
        .locator(
          '[data-gutter] > [data-column-number="30"]:not([data-line-type="change-deletion"])',
        )
        .click();
      await review
        .getByRole("textbox", { name: "Comment on src/app.ts line 30" })
        .fill(`From the review page (${stamp})`);
      await review.getByRole("button", { name: "Comment", exact: true }).click();
      await expect(review.getByRole("region", { name: "Comments for the agent" })).toContainText(
        "1 comment goes with your next message",
      );
      await proof("review-page");
      // On a phone the tree waits in a drawer behind Files.
      const size = page.viewportSize();
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(review.getByRole("navigation", { name: "Changed files" })).toBeHidden();
      await proof("review-page-phone");
      await review.getByRole("button", { name: "Files" }).click();
      await expect(page.getByRole("treeitem", { name: /app\.ts/ }).last()).toBeVisible();
      await proof("review-page-phone-files");
      await page.getByRole("button", { name: "Close files" }).first().click();
      if (size) await page.setViewportSize(size);
      await review.getByRole("link", { name: "Back to the thread" }).click();
      await expect(transcript).toBeVisible();
      await expect(tray).toContainText("1 comment goes with your next message");
    });

    await step("Hide sidebar folds the thread list away; Show sidebar brings it back", async () => {
      const sidebar = page.getByRole("complementary", { name: "Threads", includeHidden: true });
      await page.getByRole("button", { name: "Hide sidebar" }).click();
      await expect(sidebar).toHaveAttribute("data-state", "closed");
      await expect(sidebar).toBeHidden();
      await expect(page.getByRole("button", { name: "Show sidebar" })).toBeVisible();
      await proof("sidebar-hidden");
      await page.getByRole("button", { name: "Show sidebar" }).click();
      await expect(sidebar).toBeVisible();
    });
  },
  { requires: ["shelley"] },
);
