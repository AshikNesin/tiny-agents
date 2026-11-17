/**
 * @vitest-environment jsdom
 *
 * The Reviews screen's inbox from GitHub (issue #345): sections by what each
 * PR needs from the owner; a PR of a project opens its review here, one of
 * another repository opens on GitHub. The network is the boundary.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ReviewsScreen } from "@/pages/code/ReviewsScreen";
import type { InboxPullView } from "../../../apps/web/src/shared/api/code";

const pull = (number: number, over: Partial<InboxPullView> = {}): InboxPullView => ({
  section: "needs",
  repo: "acme/web",
  number,
  title: `PR ${number}`,
  url: `https://github.com/acme/web/pull/${number}`,
  author: "maria",
  draft: false,
  updatedAt: "2026-11-17T09:00:00Z",
  decision: null,
  lastReviewAt: null,
  projectId: "p1",
  reviewId: null,
  ...over,
});

const answer = (data: unknown, status = 200) =>
  new Response(JSON.stringify(status === 200 ? { success: true, data } : data), {
    status,
    headers: { "content-type": "application/json" },
  });

function stubFetch(inbox: InboxPullView[] | Response) {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const path = new URL(String(url), "http://x").pathname;
    if (path.endsWith("/reviews/inbox")) return inbox instanceof Response ? inbox : answer(inbox);
    if (path.endsWith("/reviews") && init?.method === "POST") return answer({ id: "rv9" });
    return answer([]);
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

const show = () =>
  render(
    <MemoryRouter initialEntries={["/code/reviews"]}>
      <Routes>
        <Route path="/code/reviews" element={<ReviewsScreen />} />
        <Route path="/code/reviews/:id" element={<p>Review page</p>} />
      </Routes>
    </MemoryRouter>,
  );

afterEach(() => vi.unstubAllGlobals());

describe("the review inbox", () => {
  it("lists PRs by what they need from you", async () => {
    stubFetch([
      pull(1),
      pull(2, { section: "updated", decision: "changes_requested" }),
      pull(3, { section: "waiting" }),
      pull(4, { section: "mine", draft: true }),
    ]);
    show();

    const needs = await screen.findByRole("region", { name: "Needs your review" });
    expect(needs).toHaveTextContent("#1PR 1");
    expect(screen.getByRole("region", { name: "Updated since your review" })).toHaveTextContent(
      "Changes requested",
    );
    expect(screen.getByRole("region", { name: "Waiting on author" })).toHaveTextContent("#3");
    expect(screen.getByRole("region", { name: "Your pull requests" })).toHaveTextContent("Draft");
  });

  it("opens a project's PR as a review here, and another repository's on GitHub", async () => {
    const user = userEvent.setup();
    const fetch = stubFetch([
      pull(1),
      pull(5, { repo: "other/lib", url: "https://github.com/other/lib/pull/5", projectId: null }),
    ]);
    show();
    const needs = await screen.findByRole("region", { name: "Needs your review" });

    expect(within(needs).getByRole("link", { name: /#5/ })).toHaveAttribute(
      "href",
      "https://github.com/other/lib/pull/5",
    );
    await user.click(within(needs).getByRole("button", { name: /#1/ }));

    expect(await screen.findByText("Review page")).toBeInTheDocument();
    const post = fetch.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({
      pr: "https://github.com/acme/web/pull/1",
    });
  });

  it("says why when GitHub cannot be read", async () => {
    stubFetch(
      answer(
        {
          success: false,
          error: { message: "Cannot read your review requests on GitHub: Bad credentials" },
        },
        400,
      ),
    );
    show();

    expect(
      await screen.findByText("Cannot read your review requests on GitHub: Bad credentials"),
    ).toBeInTheDocument();
  });
});
