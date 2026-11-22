/**
 * @vitest-environment jsdom
 *
 * A PR review's file list, beside the diff, can be made wider or narrower
 * like the assistant on the right: a divider you drag or move with the arrow
 * keys, remembered in this browser. The network is the boundary: fetch is
 * stubbed.
 */
import { fireEvent, render as renderBare, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ConfirmProvider } from "@groot/ui/primitives";
import { PullReview } from "@/pages/code/PullReview";
import type {
  PullReviewView,
  ReviewFile,
  ReviewFileDiff,
} from "../../../apps/web/src/shared/api/code";
import { AppQueryProvider } from "../query-provider";

const render = (ui: Parameters<typeof renderBare>[0]) =>
  renderBare(ui, { wrapper: AppQueryProvider });

const REVIEW: PullReviewView = {
  id: "rv1",
  key: "review:rv1",
  projectId: "p1",
  repo: "acme/api",
  number: 482,
  url: "https://github.com/acme/api/pull/482",
  title: "Retry webhooks",
  author: "maria",
  headRef: "retry-webhooks",
  baseRef: "main",
  headSha: "abc",
  fromFork: false,
  mine: false,
  reviewedSha: null,
  threadId: null,
  codingThreadId: null,
  worktreeThreadId: null,
  assistant: null,
  archived: false,
  brief: null,
  reviewing: false,
  findings: [],
  updatedAt: "2026-11-17T00:00:00.000Z",
};

const FILE: ReviewFile = {
  path: "src/retry.ts",
  status: "modified",
  additions: 1,
  deletions: 1,
  isGenerated: false,
  hash: "h1",
  viewed: false,
};

const DIFF: ReviewFileDiff = {
  path: "src/retry.ts",
  oldContent: "a\n",
  newContent: "b\n",
} as ReviewFileDiff;

const answer = (data: unknown) =>
  new Response(JSON.stringify({ success: true, data }), {
    headers: { "content-type": "application/json" },
  });

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = new URL(String(url), "http://x").pathname;
      if (path.endsWith("/reviews/rv1")) return answer(REVIEW);
      if (path.endsWith("/review/files")) return answer([FILE]);
      if (path.endsWith("/review/file")) return answer(DIFF);
      if (path.endsWith("/reviews/rv1/threads")) return answer({ headSha: "abc", threads: [] });
      return answer([]);
    }),
  );
}

const renderReview = () =>
  render(
    <ConfirmProvider>
      <MemoryRouter initialEntries={["/code/reviews/rv1"]}>
        <Routes>
          <Route
            path="/code/reviews/:id"
            element={<PullReview reviewId="rv1" harnesses={[]} rows={[]} />}
          />
        </Routes>
      </MemoryRouter>
    </ConfirmProvider>,
  );

const divider = () => screen.getByRole("separator", { name: "Resize file list" });
const listWidth = () =>
  screen.getByRole("navigation", { name: "Changed files" }).style.getPropertyValue("--files-width");

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("a PR review's file list", () => {
  it("resizes from the keyboard within its limits, and remembers the width", async () => {
    stubFetch();
    const { unmount } = renderReview();
    await screen.findByRole("navigation", { name: "Changed files" });
    expect(listWidth()).toBe("");
    expect(divider()).toHaveAttribute("aria-valuemin", "200");
    expect(divider()).toHaveAttribute("aria-valuemax", "640");

    fireEvent.keyDown(divider(), { key: "Home" });
    expect(divider()).toHaveAttribute("aria-valuenow", "200");
    fireEvent.keyDown(divider(), { key: "ArrowRight" });
    expect(listWidth()).toBe("216px");
    fireEvent.keyDown(divider(), { key: "ArrowLeft", shiftKey: true });
    expect(divider()).toHaveAttribute("aria-valuenow", "200");
    fireEvent.keyDown(divider(), { key: "End" });
    expect(listWidth()).toBe("640px");

    unmount();
    renderReview();
    await screen.findByRole("navigation", { name: "Changed files" });
    expect(listWidth()).toBe("640px");
  });

  it("goes back to its default width on double-click, apart from the assistant's", async () => {
    window.localStorage.setItem("code:files-width", "400");
    window.localStorage.setItem("code:review-width", "500");
    stubFetch();
    renderReview();
    await screen.findByRole("navigation", { name: "Changed files" });
    expect(listWidth()).toBe("400px");

    fireEvent.doubleClick(divider());
    expect(listWidth()).toBe("");
    expect(window.localStorage.getItem("code:files-width")).toBeNull();
    expect(window.localStorage.getItem("code:review-width")).toBe("500");
  });
});
