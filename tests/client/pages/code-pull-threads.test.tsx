/**
 * @vitest-environment jsdom
 *
 * A PR review's conversations from GitHub (issue #345): read when the review
 * opens, each under its line with Reply and Resolve; listed above the diff
 * when GitHub has them on a newer commit or the code moved on. The network
 * is the boundary: fetch is stubbed.
 */
import { render as renderBare, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { usePullConversations } from "@/pages/code/PullThreads";
import { FileDiff } from "@/pages/code/UnifiedDiff";
import type {
  PullReviewView,
  PullThreadsView,
  PullThreadView,
} from "../../../apps/web/src/shared/api/code";
import { diffRoot } from "../diff-dom";
import { AppQueryProvider } from "../query-provider";

/** Each render gets its own React Query cache, as the app gives the page one. */
const render = (ui: Parameters<typeof renderBare>[0]) =>
  renderBare(ui, { wrapper: AppQueryProvider });

const REVIEW = {
  id: "rv1",
  headSha: "head1",
} as PullReviewView;

const thread = (over: Partial<PullThreadView>): PullThreadView => ({
  id: "T_1",
  path: "src/a.ts",
  side: "new",
  line: 2,
  startLine: null,
  resolved: false,
  outdated: false,
  comments: [
    {
      id: "C_1",
      author: "carol",
      bot: false,
      body: "Why caps?",
      createdAt: "2026-11-16T10:00:00Z",
    },
  ],
  ...over,
});

/** Answers the threads read with `data`; records every call. */
function stubFetch(data: PullThreadsView) {
  const fetch = vi.fn(async (url: string, _init?: RequestInit) =>
    String(url).endsWith("/threads")
      ? new Response(JSON.stringify({ success: true, data }), {
          headers: { "content-type": "application/json" },
        })
      : new Response(JSON.stringify({ success: true, data: {} }), {
          headers: { "content-type": "application/json" },
        }),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

function File() {
  const conversations = usePullConversations(REVIEW, 0)?.("src/a.ts");
  return (
    <>
      {conversations?.aside}
      <FileDiff
        path="src/a.ts"
        oldContent={"one\ntwo\n"}
        newContent={"one\nTWO\n"}
        notes={conversations?.notes}
      />
    </>
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("a review's conversations from GitHub", () => {
  it("shows one under its line, and replies and resolves on GitHub", async () => {
    const user = userEvent.setup();
    const fetch = stubFetch({ headSha: "head1", threads: [thread({})] });
    render(<File />);
    await diffRoot();

    const card = await screen.findByRole("group", { name: "Conversation on line 2" });
    expect(card).toHaveTextContent("Why caps?");
    // Slotted under its line.
    expect(card.closest("[slot]")?.getAttribute("slot")).toMatch(/additions-2/);

    await user.click(within(card).getByRole("button", { name: "Reply" }));
    await user.type(within(card).getByRole("textbox", { name: "Reply on line 2" }), "Fixed");
    await user.click(within(card).getByRole("button", { name: "Reply" }));
    await user.click(await within(card).findByRole("button", { name: "Resolve" }));

    const posts = fetch.mock.calls
      .filter(([, init]) => init?.method === "POST")
      .map(([url, init]) => [new URL(String(url), "http://x").pathname, init?.body ?? null]);
    expect(posts).toEqual([
      ["/api/v1/code/reviews/rv1/threads/T_1/reply", JSON.stringify({ body: "Fixed" })],
      ["/api/v1/code/reviews/rv1/threads/T_1/resolve", null],
    ]);
  });

  it("folds a resolved one", async () => {
    stubFetch({ headSha: "head1", threads: [thread({ resolved: true })] });
    render(<File />);
    await diffRoot();

    const card = await screen.findByRole("group", { name: "Resolved conversation on line 2" });
    expect(card).not.toHaveTextContent("Why caps?");
    expect(within(card).getByRole("button", { expanded: false })).toHaveTextContent("@carol");
  });

  it("lists them above the diff when GitHub has them on a newer commit", async () => {
    const user = userEvent.setup();
    stubFetch({ headSha: "head2", threads: [thread({})] });
    render(<File />);
    await diffRoot();

    const fold = await screen.findByRole("button", {
      name: "1 conversation on the PR's newer commit. Update to see them in place.",
    });
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
    await user.click(fold);
    expect(screen.getByRole("group", { name: "Conversation on line 2" })).toBeInTheDocument();
  });

  it("lists outdated ones above the diff", async () => {
    stubFetch({
      headSha: "head1",
      threads: [thread({ line: null, outdated: true })],
    });
    render(<File />);
    await diffRoot();

    expect(
      await screen.findByRole("button", { name: "1 conversation on code that has changed since" }),
    ).toBeInTheDocument();
  });
});
