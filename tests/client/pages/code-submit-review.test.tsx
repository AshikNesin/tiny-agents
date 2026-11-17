/**
 * @vitest-environment jsdom
 *
 * Submitting a PR review (issue #345): the waiting comments, a summary and
 * the verdict go to the server in one call; on the owner's own PR only a
 * comment is offered. The network is the boundary: fetch is stubbed.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { MemoryRouter } from "react-router-dom";
import { SubmitReview } from "@/pages/code/SubmitReview";
import type { ThreadCommenting } from "@/lib/code/comments";
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
  headRef: "maria:retry",
  baseRef: "main",
  headSha: "abc",
  fromFork: true,
  mine: false,
  threadId: null,
  codingThreadId: null,
  archived: false,
  updatedAt: "2026-11-17T00:00:00.000Z",
};

const github = (bodies: string[]): ThreadCommenting => ({
  comments: bodies.map((body, i) => ({
    id: `c${i}`,
    path: "src/retry.ts",
    side: "new",
    startLine: 12,
    endLine: 12,
    quote: "",
    body,
    createdAt: "2026-11-17T00:00:00.000Z",
  })),
  add: async () => {},
  remove: () => {},
});

function stubFetch() {
  const fetch = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(
        JSON.stringify({ success: true, data: { url: "https://github.com/x", comments: 1 } }),
        { headers: { "content-type": "application/json" } },
      ),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

const show = (review: PullReviewView, comments: ThreadCommenting) =>
  render(
    <MemoryRouter>
      <SubmitReview review={review} github={comments} open onOpenChange={() => {}} />
    </MemoryRouter>,
  );

afterEach(() => vi.unstubAllGlobals());

describe("Submit review", () => {
  it("sends the verdict and summary for the waiting comments", async () => {
    const user = userEvent.setup();
    const fetch = stubFetch();
    show(REVIEW, github(["Cap the delay"]));

    expect(screen.getByRole("list", { name: "Review comments" })).toHaveTextContent(
      "src/retry.ts:12Cap the delay",
    );
    await user.click(screen.getByRole("button", { name: "Request changes" }));
    // GitHub needs a summary to request changes.
    expect(screen.getByRole("button", { name: "Submit review" })).toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: "Review summary" }), "One thing");
    await user.click(screen.getByRole("button", { name: "Submit review" }));

    const call = fetch.mock.calls.find(([url]) => String(url).endsWith("/reviews/rv1/submit"));
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      event: "REQUEST_CHANGES",
      body: "One thing",
    });
  });

  it("on the owner's own PR offers only a comment", () => {
    show({ ...REVIEW, mine: true }, github(["Note"]));

    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Request changes" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Comment" })).toBeEnabled();
    expect(
      screen.getByText("This is your pull request: GitHub lets you comment on it, not approve it."),
    ).toBeInTheDocument();
  });

  it("offers the Code thread that opened the PR only when one did", () => {
    const { unmount } = show(REVIEW, github(["Note"]));
    expect(screen.queryByRole("button", { name: "Send to coding thread" })).not.toBeInTheDocument();
    unmount();

    show({ ...REVIEW, mine: true, codingThreadId: "shelley:t1" }, github(["Note"]));
    expect(screen.getByRole("button", { name: "Send to coding thread" })).toBeEnabled();
  });
});
