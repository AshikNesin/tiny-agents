// Feature: code (features/code.md), PR reviews (issue #345). The Reviews screen opens a
// pull request by its link; its page shows the PR's changes at full height with the
// assistant beside them. A line comment for the assistant waits under the review, and the
// first question starts the assistant (a real predictable Shelley thread,
// `ta-verify up --shelley`). A comment for GitHub, with a suggestion, goes with Submit review,
// and a conversation already on GitHub shows under its line, with Reply and Resolve.
//
// The verify instance reaches neither GitHub nor a sandbox, so the review's own routes
// (the PR from GitHub, its files and diffs from the sandbox's worktree) are answered with
// page.route fixtures, and so are the review's GitHub comments, its submit and the PR's
// conversations. The
// assistant's comments, viewed marks and its thread are the real app.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { devices } from "@playwright/test";
import { journey, expect } from "../scripts/lib.mjs";

const OLD = Array.from({ length: 24 }, (_, i) => `const line${i + 1} = ${i + 1};`);
const NEW = OLD.map((l, i) =>
  i === 11 ? "const delay = base * 2 ** attempt; // capped below" : l,
).concat(["export const MAX_DELAY_MS = 30_000;"]);

await journey(
  "code-reviews",
  async ({ page, context, step, proof, cleanup, api, stamp }) => {
    const dir = path.join(
      process.cwd(),
      "data",
      "verify",
      process.env.TA_VERIFY_RUN,
      `rv-${stamp}`,
    );
    const review = {
      id: `rv${stamp}`.replace(/[^a-z0-9]/gi, ""),
      projectId: "p1",
      repo: "acme/api",
      number: 482,
      url: "https://github.com/acme/api/pull/482",
      title: "Retry webhooks with backoff",
      author: "maria",
      headRef: "maria:retry-webhooks",
      baseRef: "main",
      headSha: "0123456789abcdef0123456789abcdef01234567",
      fromFork: true,
      mine: false,
      threadId: null,
      codingThreadId: null,
      archived: false,
      updatedAt: new Date().toISOString(),
    };
    review.key = `review:${review.id}`;
    const files = [
      {
        path: "src/webhooks/retry.ts",
        status: "modified",
        additions: 2,
        deletions: 1,
        isGenerated: false,
        hash: "h1",
        viewed: false,
      },
      {
        path: "src/webhooks/queue.ts",
        status: "added",
        additions: 12,
        deletions: 0,
        isGenerated: false,
        hash: "h2",
        viewed: false,
      },
      {
        path: "pnpm-lock.yaml",
        status: "modified",
        additions: 40,
        deletions: 3,
        isGenerated: true,
        hash: "h3",
        viewed: false,
      },
    ];
    const ok = (data) => ({ json: { success: true, data } });
    const asked = [];
    const githubComments = [];
    const submitted = [];
    const replies = [];
    const conversation = {
      id: "T_1",
      path: "src/webhooks/retry.ts",
      side: "new",
      line: 12,
      startLine: null,
      resolved: false,
      outdated: false,
      comments: [
        {
          id: "C_1",
          author: "carol",
          bot: false,
          body: "Should this have **jitter**?",
          createdAt: new Date(Date.now() - 3_600_000).toISOString(),
        },
      ],
    };

    await step("setup: a throwaway checkout for the assistant, and the PR fixtures", async () => {
      mkdirSync(dir, { recursive: true });
      cleanup(() => rmSync(dir, { recursive: true, force: true }));
      writeFileSync(path.join(dir, "README.md"), "acme/api\n");
      const git = (...args) =>
        execFileSync("git", ["-c", "user.email=v@example.com", "-c", "user.name=v", ...args], {
          cwd: dir,
          stdio: "ignore",
        });
      git("init", "-q");
      git("add", ".");
      git("commit", "-qm", "init");
      cleanup(async () => {
        const all = await api.get("/code/threads");
        for (const t of all.filter((t) => t.cwd === dir)) {
          await api.delete(`/code/threads/${encodeURIComponent(t.id)}`);
        }
      });
      const key = encodeURIComponent(review.key);
      await context.route("**/api/v1/code/reviews", (route) =>
        route.request().method() === "POST"
          ? route.fulfill({ ...ok(review), status: 201 })
          : route.fulfill(ok([review])),
      );
      await context.route("**/api/v1/code/reviews/inbox", (route) =>
        route.fulfill(
          ok([
            {
              section: "needs",
              repo: review.repo,
              number: review.number,
              title: review.title,
              url: review.url,
              author: review.author,
              draft: false,
              updatedAt: review.updatedAt,
              decision: "review_required",
              lastReviewAt: null,
              projectId: review.projectId,
              reviewId: null,
            },
            {
              section: "mine",
              repo: "acme/web",
              number: 77,
              title: "Dark mode toggle",
              url: "https://github.com/acme/web/pull/77",
              author: "demo",
              draft: true,
              updatedAt: review.updatedAt,
              decision: null,
              lastReviewAt: null,
              projectId: null,
              reviewId: null,
            },
          ]),
        ),
      );
      await context.route(`**/api/v1/code/reviews/${review.id}`, (route) =>
        route.fulfill(ok(review)),
      );
      await context.route(`**/api/v1/code/threads/${key}/review/files`, (route) =>
        route.fulfill(ok(files)),
      );
      await context.route(`**/api/v1/code/threads/${key}/review/file?*`, (route) => {
        const file = new URL(route.request().url()).searchParams.get("path");
        return route.fulfill(
          ok(
            file === "src/webhooks/retry.ts"
              ? { path: file, oldContent: `${OLD.join("\n")}\n`, newContent: `${NEW.join("\n")}\n` }
              : { path: file, oldContent: "", newContent: "export const queue = [];\n" },
          ),
        );
      });
      await context.route(`**/api/v1/code/reviews/${review.id}/comments`, (route) => {
        if (route.request().method() !== "POST") return route.fulfill(ok(githubComments));
        const comment = {
          id: `g${githubComments.length + 1}`,
          side: "new",
          quote: "",
          createdAt: new Date().toISOString(),
          ...route.request().postDataJSON(),
        };
        githubComments.push(comment);
        return route.fulfill({ ...ok(comment), status: 201 });
      });
      await context.route(`**/api/v1/code/reviews/${review.id}/threads`, (route) =>
        route.fulfill(ok({ headSha: review.headSha, threads: [conversation] })),
      );
      await context.route(`**/api/v1/code/reviews/${review.id}/threads/T_1/*`, (route) => {
        const action = route.request().url().split("/").pop();
        if (action === "reply") {
          const { body } = route.request().postDataJSON();
          replies.push(body);
          conversation.comments.push({
            id: `C_${conversation.comments.length + 1}`,
            author: "demo",
            bot: false,
            body,
            createdAt: new Date().toISOString(),
          });
        } else conversation.resolved = true;
        return route.fulfill(ok({}));
      });
      await context.route(`**/api/v1/code/reviews/${review.id}/submit`, (route) => {
        submitted.push(route.request().postDataJSON());
        const count = githubComments.splice(0).length;
        return route.fulfill(ok({ url: review.url, comments: count }));
      });
      // The first question: the app starts the assistant; here a real Shelley thread in
      // the throwaway checkout, given the message the server would send.
      await context.route(`**/api/v1/code/reviews/${review.id}/ask`, async (route) => {
        const { message } = route.request().postDataJSON();
        asked.push(message);
        const drafts = await api.get(`/code/threads/${key}/review/drafts`);
        const comments = drafts
          .map((d) => `**\`${d.path}:${d.startLine}\`**\n\`\`\`\n${d.quote}\n\`\`\`\n${d.body}`)
          .join("\n\n---\n\n");
        const card = [
          `[Review ${review.repo}#${review.number} · head ${review.headSha.slice(0, 12)} · base main]`,
          "You help the owner review this pull request; you did not write it.",
          "----- END OF PULL REQUEST -----",
        ].join("\n");
        const body = drafts.length
          ? `${card}\n\nReview comments (${drafts.length}):\n\n${comments}\n\n---\n\n${message}`
          : `${card}\n\n${message}`;
        const { threadId } = await api.post("/code/threads", {
          instanceId: "shelley",
          cwd: dir,
          message: body,
        });
        for (const d of drafts) await api.delete(`/code/threads/${key}/review/drafts/${d.id}`);
        review.threadId = threadId;
        return route.fulfill(ok({ threadId }));
      });
    });

    await step(
      "the sidebar's Reviews opens the Reviews screen, which takes a PR link",
      async () => {
        await page.goto("/code", { waitUntil: "domcontentloaded" });
        await page.getByTestId("code-reviews").click();
        await expect(page).toHaveURL(/\/code\/reviews$/);
        await expect(page.getByRole("list", { name: "Open reviews" })).toContainText(
          "Retry webhooks with backoff",
        );
        await expect(page.getByRole("region", { name: "Needs your review" })).toContainText(
          "Retry webhooks with backoff",
        );
        await expect(page.getByRole("region", { name: "Your pull requests" })).toContainText(
          "Draft",
        );
      },
    );
    await proof("reviews-screen");

    await step("paste the PR's link and open its review", async () => {
      await page.getByRole("textbox", { name: "Pull request" }).fill(review.url);
      await page.getByRole("button", { name: "Review", exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/code/reviews/${review.id}$`));
      const pr = page.getByTestId("code-pull-review");
      await expect(pr.getByRole("heading", { name: "Retry webhooks with backoff" })).toBeVisible();
      await expect(pr.getByText("acme/api · @maria")).toBeVisible();
      const list = pr.getByRole("navigation", { name: "Changed files" });
      await expect(list).toContainText("retry.ts");
      await list.getByRole("button", { name: /retry\.ts/ }).click();
      await expect(
        pr.getByText("const delay = base * 2 ** attempt", { exact: false }),
      ).toBeVisible();
      await expect(pr.getByRole("button", { name: "Summarize this PR" })).toBeVisible();
      // Focus mode: no thread list.
      await expect(page.getByRole("complementary", { name: "Threads" })).toHaveCount(0);
    });
    await proof("review-open");

    await step(
      "a comment for the assistant waits under the review for the first question",
      async () => {
        const pr = page.getByTestId("code-pull-review");
        // The diff draws in a shadow root; Playwright's CSS reaches into it. Click line 12's number.
        await pr
          .locator(
            '[data-gutter] > [data-column-number="12"]:not([data-line-type="change-deletion"])',
          )
          .click();
        await pr
          .getByRole("textbox", { name: "Comment on src/webhooks/retry.ts line 12" })
          .fill(`Can this overflow for large attempts? (${stamp})`);
        await pr.getByRole("button", { name: "Ask assistant" }).click();
        await expect(pr.getByRole("note", { name: "Comment on line 12" })).toContainText(
          "For the assistant",
        );
        const tray = pr.getByRole("region", { name: "Comments for the agent" });
        await expect(tray).toContainText("1 comment goes with your next message");
        await expect(tray.getByRole("button", { name: "Send now" })).toHaveCount(0);
      },
    );
    await proof("comment-waiting");

    await step("the first question starts the assistant with the comment", async () => {
      const pr = page.getByTestId("code-pull-review");
      await pr
        .getByRole("textbox", { name: "Ask the assistant" })
        .fill(`echo: looks capped ${stamp}`);
      await pr.getByRole("button", { name: "Ask", exact: true }).click();
      const transcript = pr.getByRole("region", { name: "Messages" });
      await expect(transcript).toBeVisible({ timeout: 20_000 });
      await expect(transcript.getByLabel("Pull request")).toHaveText("Reviewing acme/api#482");
      await expect(
        transcript.getByRole("article").filter({ hasText: "src/webhooks/retry.ts:12" }),
      ).toBeVisible();
      await expect(transcript.getByText("you did not write it")).toHaveCount(0);
      await expect(pr.getByRole("textbox", { name: "Message Shelley" })).toBeVisible();
      expect(asked).toEqual([`echo: looks capped ${stamp}`]);
      await expect(pr.getByRole("note", { name: "Comment on line 12" })).toHaveCount(0);
    });
    await proof("assistant-started");

    await step("a suggestion for GitHub goes with Submit review, approved", async () => {
      const pr = page.getByTestId("code-pull-review");
      await pr
        .locator(
          '[data-gutter] > [data-column-number="25"]:not([data-line-type="change-deletion"])',
        )
        .click();
      const box = pr.getByRole("textbox", { name: "Comment on src/webhooks/retry.ts line 25" });
      await box.fill("Export it from the config instead:");
      await pr.getByRole("button", { name: "Suggest change" }).click();
      await expect(box).toHaveValue(
        "Export it from the config instead:\n\n```suggestion\nexport const MAX_DELAY_MS = 30_000;\n```",
      );
      await pr.getByRole("button", { name: "Comment", exact: true }).click();
      await expect(pr.getByRole("note", { name: "Comment on line 25" })).toContainText("Pending");
      await page.getByRole("button", { name: /Submit review/ }).click();
      const dialog = page.getByRole("dialog", { name: "Submit review" });
      await expect(dialog.getByRole("list", { name: "Review comments" })).toContainText(
        "src/webhooks/retry.ts:25",
      );
      await dialog.getByRole("button", { name: "Approve" }).click();
      await dialog.getByRole("textbox", { name: "Review summary" }).fill("Looks good.");
      await proof("submit-review");
      await dialog.getByRole("button", { name: "Submit review" }).click();
      await expect(page.getByText("Review submitted on GitHub.")).toBeVisible();
      expect(submitted).toEqual([{ event: "APPROVE", body: "Looks good." }]);
      await expect(pr.getByRole("note", { name: "Comment on line 25" })).toHaveCount(0);
    });

    await step("a conversation from GitHub sits under its line: reply, then resolve", async () => {
      const pr = page.getByTestId("code-pull-review");
      const card = pr.getByRole("group", { name: "Conversation on line 12" });
      await expect(card).toContainText("Should this have jitter?");
      await card.getByRole("button", { name: "Reply" }).click();
      await card.getByRole("textbox", { name: "Reply on line 12" }).fill(`Added it (${stamp})`);
      await card.getByRole("button", { name: "Reply" }).click();
      await expect(card.getByRole("textbox")).toHaveCount(0);
      await expect(card).toContainText(`Added it (${stamp})`);
      await proof("conversation");
      await card.getByRole("button", { name: "Resolve" }).click();
      await expect(
        pr.getByRole("group", { name: "Resolved conversation on line 12" }),
      ).toBeVisible();
      expect(replies).toEqual([`Added it (${stamp})`]);
    });

    await step("a phone shows one side at a time", async () => {
      const phone = await context.browser().newContext({
        ...devices["Pixel 7"],
        baseURL: new URL(page.url()).origin,
        storageState: await context.storageState(),
      });
      cleanup(() => phone.close());
      for (const [pattern, handler] of [
        [`**/api/v1/code/reviews/${review.id}`, (r) => r.fulfill(ok(review))],
        [
          `**/api/v1/code/threads/${encodeURIComponent(review.key)}/review/files`,
          (r) => r.fulfill(ok(files)),
        ],
        [
          `**/api/v1/code/threads/${encodeURIComponent(review.key)}/review/file?*`,
          (r) =>
            r.fulfill(
              ok({
                path: "src/webhooks/retry.ts",
                oldContent: `${OLD.join("\n")}\n`,
                newContent: `${NEW.join("\n")}\n`,
              }),
            ),
        ],
      ])
        await phone.route(pattern, handler);
      const p = await phone.newPage();
      await p.goto(`/code/reviews/${review.id}`, { waitUntil: "domcontentloaded" });
      await p.getByRole("button", { name: /retry\.ts/ }).tap();
      await expect(p.getByText("2 of 3")).toBeVisible({ timeout: 15_000 });
      const shots = path.join(process.env.TA_VERIFY_EVIDENCE, "code-reviews");
      await p.screenshot({ path: path.join(shots, "phone-files.png") });
      await p.getByRole("button", { name: "Assistant" }).tap();
      await expect(p.getByRole("textbox", { name: "Message Shelley" })).toBeVisible({
        timeout: 15_000,
      });
      await p.screenshot({ path: path.join(shots, "phone-assistant.png") });
    });
  },
  { requires: ["shelley"] },
);
