/**
 * @vitest-environment jsdom
 *
 * A PR review laid out like diffshub: every changed file in one column under
 * its own header (fold, Viewed), the assistant folded to a rail on the left
 * until opened, and line comments on any file of the column. The network is
 * the boundary: fetch is stubbed.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { MemoryRouter } from "react-router-dom";
import { ConfirmProvider } from "@groot/ui/primitives";
import { PullReview } from "@/pages/code/PullReview";
import type { PullReviewView } from "../../../apps/web/src/shared/api/code";
import { clickLine, line } from "../diff-dom";

const REVIEW = {
  id: "rv1",
  key: "review:rv1",
  projectId: "p1",
  repo: "acme/api",
  number: 482,
  url: "https://github.com/acme/api/pull/482",
  title: "Retry webhooks",
  author: "maria",
  headRef: "retry",
  baseRef: "main",
  headSha: "a".repeat(40),
  fromFork: false,
  mine: false,
  reviewedSha: null,
  threadId: null,
  codingThreadId: null,
  worktreeThreadId: null,
  assistant: null,
  archived: false,
  updatedAt: "2026-11-17T00:00:00.000Z",
} satisfies PullReviewView;

const file = (path: string, viewed = false) => ({
  path,
  status: "modified" as const,
  additions: 1,
  deletions: 1,
  isGenerated: false,
  hash: `h-${path}`,
  viewed,
});

const answer = (data: unknown) =>
  new Response(JSON.stringify({ success: true, data }), {
    headers: { "content-type": "application/json" },
  });

const thread = "/api/v1/code/threads/review%3Arv1/review";

function stubFetch() {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const at = new URL(String(url), "http://x");
    const path = at.pathname;
    if (path === "/api/v1/code/reviews/rv1") return answer(REVIEW);
    if (path === `${thread}/files`) return answer([file("src/a.ts"), file("src/b.ts")]);
    if (path === `${thread}/file`) {
      const name = at.searchParams.get("path");
      return answer({
        path: name,
        oldContent: "one\ntwo\nthree\n",
        newContent: name === "src/b.ts" ? "one\nTWO\nthree\n" : "one\n2\nthree\n",
      });
    }
    if (path === "/api/v1/code/reviews/rv1/threads")
      return answer({ headSha: REVIEW.headSha, threads: [] });
    if (path === `${thread}/drafts` && at.search === "?target=github" && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      return answer({ id: "g1", createdAt: REVIEW.updatedAt, ...body });
    }
    return answer([]);
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

function showReview() {
  render(
    <MemoryRouter>
      <ConfirmProvider>
        <PullReview reviewId="rv1" harnesses={[]} rows={[]} />
      </ConfirmProvider>
    </MemoryRouter>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("a PR review's layout", () => {
  it("starts with the assistant folded to a rail, and opens and folds it", async () => {
    const user = userEvent.setup();
    stubFetch();
    showReview();

    await user.click(await screen.findByRole("button", { name: "Open assistant" }));
    expect(screen.getByRole("textbox", { name: "Ask the assistant" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Collapse assistant" }));

    expect(screen.queryByRole("textbox", { name: "Ask the assistant" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open assistant" })).toBeInTheDocument();
  });

  it("shows every file in one column, and folds one when marked viewed", async () => {
    const user = userEvent.setup();
    const fetch = stubFetch();
    showReview();

    expect(await screen.findByRole("button", { name: "Fold src/a.ts" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fold src/b.ts" })).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Viewed src/b.ts" }));

    expect(screen.getByRole("button", { name: "Unfold src/b.ts" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Diff stats" })).toHaveTextContent("1 of 2");
    const viewed = fetch.mock.calls.find(([url]) => String(url).endsWith("/review/viewed"));
    expect(JSON.parse(String(viewed?.[1]?.body))).toEqual({
      path: "src/b.ts",
      hash: "h-src/b.ts",
      viewed: true,
    });
  });

  it("takes a comment for GitHub on a line of the second file", async () => {
    const user = userEvent.setup();
    const fetch = stubFetch();
    showReview();

    await screen.findByRole("button", { name: "Fold src/b.ts" });
    let root: ShadowRoot | undefined;
    await waitFor(() => {
      root = [...document.querySelectorAll("diffs-container")]
        .map((el) => el.shadowRoot!)
        .find((r) => r.textContent?.includes("TWO") && r.querySelector("[data-column-number]"));
      if (!root) throw new Error("b.ts not drawn");
    });
    await clickLine(line(root!, 2));
    const box = await screen.findByRole("textbox", { name: "Comment on src/b.ts line 2" });
    await user.type(box, "Why caps?");
    await user.click(screen.getByRole("button", { name: "Comment" }));

    const post = fetch.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith("/review/drafts?target=github") && init?.method === "POST",
    );
    expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({
      path: "src/b.ts",
      side: "new",
      startLine: 2,
      endLine: 2,
      body: "Why caps?",
    });
    const note = await screen.findByRole("note", { name: "Comment on line 2" });
    expect(within(note).getByText("Pending")).toBeInTheDocument();
  });
});
