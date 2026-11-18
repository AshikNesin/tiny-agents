/**
 * @vitest-environment jsdom
 *
 * A PR review's header on a phone: the checkout's terminal, Update and Open
 * on GitHub fold into one More actions menu, so the PR's title keeps its
 * room. The network is the boundary: fetch is stubbed.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ConfirmProvider } from "@groot/ui/primitives";
import { PullReview } from "@/pages/code/PullReview";
import type { PullReviewView } from "../../../apps/web/src/shared/api/code";

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
  updatedAt: "2026-11-17T00:00:00.000Z",
};

const answer = (data: unknown) =>
  new Response(JSON.stringify({ success: true, data }), {
    headers: { "content-type": "application/json" },
  });

function stubFetch() {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const path = new URL(String(url), "http://x").pathname;
    if (path.endsWith("/reviews/rv1/terminal") && init?.method === "POST")
      return answer({ name: "review-482" });
    if (path.endsWith("/reviews/rv1")) return answer(REVIEW);
    return answer([]);
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => vi.unstubAllGlobals());

describe("a PR review's header", () => {
  it("names the branches and keeps the checkout's tools in a More actions menu", async () => {
    const user = userEvent.setup();
    stubFetch();
    render(
      <ConfirmProvider>
        <MemoryRouter initialEntries={["/code/reviews/rv1"]}>
          <Routes>
            <Route
              path="/code/reviews/:id"
              element={<PullReview reviewId="rv1" harnesses={[]} rows={[]} />}
            />
            <Route path="/terminal" element={<p>Terminal page</p>} />
          </Routes>
        </MemoryRouter>
      </ConfirmProvider>,
    );

    expect(await screen.findByText(/retry-webhooks → main/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "More actions" }));
    expect(screen.getByRole("menuitem", { name: "Open on GitHub" })).toHaveAttribute(
      "href",
      "https://github.com/acme/api/pull/482",
    );
    expect(screen.getByRole("menuitem", { name: "Update to the latest commit" })).toBeVisible();
    await user.click(screen.getByRole("menuitem", { name: "Open in terminal" }));

    expect(await screen.findByText("Terminal page")).toBeInTheDocument();
  });
});
