/**
 * @vitest-environment jsdom
 *
 * The Reviews screen's inbox from GitHub (issue #345): sections by what each
 * PR needs from the owner; a PR of a project opens its review here, one of
 * another repository opens on GitHub. The network is the boundary.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ReviewsScreen } from "@/pages/code/ReviewsScreen";
import { AppQueryProvider } from "../query-provider";
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

function stubFetch(inbox: InboxPullView[] | Response, open: unknown[] = []) {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const path = new URL(String(url), "http://x").pathname;
    if (path.endsWith("/reviews/inbox")) return inbox instanceof Response ? inbox : answer(inbox);
    if (path.endsWith("/reviews") && init?.method === "POST") return answer({ id: "rv9" });
    if (path.endsWith("/reviews")) return answer(open);
    return answer([]);
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

const show = () =>
  render(
    <AppQueryProvider>
      <MemoryRouter initialEntries={["/code/reviews"]}>
        <Routes>
          <Route path="/code/reviews" element={<ReviewsScreen />} />
          <Route path="/code/reviews/:id" element={<p>Review page</p>} />
        </Routes>
      </MemoryRouter>
    </AppQueryProvider>,
  );

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const inboxQuery = (fetch: ReturnType<typeof stubFetch>) =>
  fetch.mock.calls
    .map(([url]) => new URL(String(url), "http://x"))
    .filter((url) => url.pathname.endsWith("/reviews/inbox"))
    .map((url) => url.search);

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

  it("gives each row its own review action and its own GitHub link", async () => {
    const user = userEvent.setup();
    const fetch = stubFetch([
      pull(1),
      pull(5, { repo: "other/lib", url: "https://github.com/other/lib/pull/5", projectId: null }),
    ]);
    show();
    const needs = await screen.findByRole("region", { name: "Needs your review" });

    expect(within(needs).getByRole("link", { name: "Open #1 on GitHub" })).toHaveAttribute(
      "href",
      "https://github.com/acme/web/pull/1",
    );
    expect(within(needs).getByRole("link", { name: "Open #5 on GitHub" })).toHaveAttribute(
      "href",
      "https://github.com/other/lib/pull/5",
    );
    // Another repository's PR is reviewed here once it is a project: one step away (#386).
    expect(within(needs).queryByRole("button", { name: /#5/ })).toBeNull();
    expect(
      within(needs).getByRole("link", { name: "Add other/lib as a project to review #5 here" }),
    ).toHaveAttribute("href", "/code/settings/projects?repo=other%2Flib");

    await user.click(within(needs).getByRole("button", { name: /^Review #1/ }));

    expect(await screen.findByText("Review page")).toBeInTheDocument();
    const post = fetch.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({
      pr: "https://github.com/acme/web/pull/1",
    });
  });

  it("shows a PR once: an open review in the inbox is not listed again under Open here", async () => {
    const review = (number: number, repo = "acme/web") => ({
      id: `rv${number}`,
      number,
      title: `PR ${number}`,
      repo,
      author: "maria",
      url: `https://github.com/${repo}/pull/${number}`,
      updatedAt: "2026-11-17T09:00:00Z",
    });
    stubFetch([pull(1, { reviewId: "rv1" })], [review(1), review(8, "acme/api")]);
    show();

    expect(await screen.findByRole("region", { name: "Needs your review" })).toHaveTextContent(
      "#1PR 1",
    );
    const open = await screen.findByRole("list", { name: "Open reviews" });
    expect(within(open).getAllByRole("listitem")).toHaveLength(1);
    expect(open).toHaveTextContent("#8PR 8");
    expect(open).not.toHaveTextContent("PR 1");
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

describe("filtering the inbox", () => {
  it("asks again for what the filters keep, and remembers them next time", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const fetch = stubFetch([
      pull(1),
      pull(2, { repo: "acme/api", url: "https://github.com/acme/api/pull/2" }),
    ]);
    const { unmount } = show();
    await screen.findByRole("region", { name: "Needs your review" });

    await user.click(screen.getByRole("combobox", { name: "Updated" }));
    await user.click(await screen.findByRole("option", { name: "Past 30 days" }));
    await user.click(screen.getByRole("combobox", { name: "Repository" }));
    await user.click(await screen.findByRole("option", { name: "acme/api" }));
    await user.click(screen.getByRole("checkbox", { name: "Hide drafts" }));

    await waitFor(() =>
      expect(inboxQuery(fetch).at(-1)).toBe("?days=30&repo=acme%2Fapi&drafts=hide"),
    );
    expect(inboxQuery(fetch)[0]).toBe("");

    unmount();
    fetch.mockClear();
    show();
    await screen.findByRole("region", { name: "Needs your review" });
    expect(inboxQuery(fetch)).toEqual(["?days=30&repo=acme%2Fapi&drafts=hide"]);
    expect(screen.getByRole("combobox", { name: "Updated" })).toHaveTextContent("Past 30 days");
  });

  it("offers a way back when the filters hide everything", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    window.localStorage.setItem("code.reviews.filter", JSON.stringify({ days: 7 }));
    const fetch = stubFetch([]);
    show();

    expect(await screen.findByText("Nothing matches these filters.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));

    await waitFor(() => expect(inboxQuery(fetch).at(-1)).toBe(""));
  });
});
