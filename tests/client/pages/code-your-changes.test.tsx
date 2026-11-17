/**
 * @vitest-environment jsdom
 *
 * Changing a PR's code from its review (issue #345): the "Your changes"
 * scope shows what you or the assistant changed on top of the PR's head,
 * with Push to PR (after a confirm naming the author's branch), Post as
 * suggestions and Discard; Open in terminal opens a tab in the checkout.
 * The network is the boundary: fetch is stubbed.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { ConfirmProvider } from "@groot/ui/primitives";
import { ReviewPanel } from "@/pages/code/ReviewPanel";
import { OpenInTerminal, YourChangesActions } from "@/pages/code/YourChanges";
import type { PullReviewView } from "../../../apps/web/src/shared/api/code";

const REVIEW = {
  id: "rv1",
  key: "review:rv1",
  number: 7,
  author: "maria",
  headRef: "retry-webhooks",
  headSha: "a".repeat(40),
  mine: false,
} as PullReviewView;

const file = (path: string) => ({
  path,
  status: "modified" as const,
  additions: 1,
  deletions: 1,
  isGenerated: false,
  hash: `h-${path}`,
  viewed: false,
});

/** Answers by method, path and `since`; records every call. */
function stubFetch(answers: Record<string, unknown>) {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const at = new URL(String(url), "http://x");
    const since = at.searchParams.get("since");
    const key = `${init?.method ?? "GET"} ${at.pathname}${since ? `#${since}` : ""}`;
    const data = key in answers ? answers[key] : {};
    return new Response(JSON.stringify({ success: true, data }), {
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

const posts = (fetch: ReturnType<typeof stubFetch>) =>
  fetch.mock.calls
    .filter(([, init]) => init?.method === "POST")
    .map(([url, init]) => [new URL(String(url), "http://x").pathname, init?.body ?? null]);

const thread = "/api/v1/code/threads/review%3Arv1/review";

function showPanel(answers: Record<string, unknown>) {
  const fetch = stubFetch({
    [`GET ${thread}/files`]: [file("src/a.ts"), file("src/b.ts")],
    [`GET ${thread}/file`]: {
      path: "src/a.ts",
      oldContent: "a\n",
      newContent: "b\n",
    },
    [`GET ${thread}/file#mine`]: {
      path: "src/a.ts",
      oldContent: "b\n",
      newContent: "c\n",
    },
    [`GET ${thread}/drafts`]: [],
    ...answers,
  });
  render(
    <ConfirmProvider>
      <ReviewPanel
        threadId="review:rv1"
        baseBranch="main"
        refreshKey="1"
        page
        pull={{
          headRef: REVIEW.headRef,
          yourChanges: (done) => <YourChangesActions review={REVIEW} onChanged={done} />,
        }}
      />
    </ConfirmProvider>,
  );
  return fetch;
}

async function pickYourChanges(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Changes to show" }));
  await user.click(await screen.findByRole("option", { name: /Your changes/ }));
}

afterEach(() => vi.unstubAllGlobals());

describe("your changes to a PR", () => {
  it("lists them apart from the PR's, and pushes them after a confirm naming the branch", async () => {
    const user = userEvent.setup();
    const fetch = showPanel({
      [`GET ${thread}/files#mine`]: [file("src/a.ts")],
    });

    await pickYourChanges(user);

    const list = await screen.findByRole("navigation", {
      name: "Changed files",
    });
    expect(list).toHaveTextContent("a.ts");
    expect(list).not.toHaveTextContent("b.ts");
    await user.click(screen.getByRole("button", { name: "Push to PR" }));
    const dialog = screen.getByRole("dialog", {
      name: "Push to the pull request",
    });
    expect(dialog).toHaveTextContent("Adds a commit to @maria's branch retry-webhooks.");
    expect(within(dialog).getByRole("button", { name: "Push" })).toBeDisabled();
    await user.type(within(dialog).getByRole("textbox", { name: "Commit message" }), "Cap it");
    await user.click(within(dialog).getByRole("button", { name: "Push" }));

    expect(posts(fetch)).toContainEqual([
      "/api/v1/code/reviews/rv1/push",
      JSON.stringify({ message: "Cap it" }),
    ]);
  });

  it("posts them as suggestions, or discards them after a confirm", async () => {
    const user = userEvent.setup();
    const fetch = showPanel({
      [`GET ${thread}/files#mine`]: [file("src/a.ts")],
      "POST /api/v1/code/reviews/rv1/suggestions": { added: 2, skipped: 0 },
    });
    await pickYourChanges(user);

    await user.click(await screen.findByRole("button", { name: "Post as suggestions" }));
    await user.click(screen.getByRole("button", { name: "Discard" }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Discard",
      }),
    );

    expect(posts(fetch)).toEqual([
      ["/api/v1/code/reviews/rv1/suggestions", null],
      ["/api/v1/code/reviews/rv1/discard", null],
    ]);
  });

  it("says how to change code when there is nothing of yours yet", async () => {
    const user = userEvent.setup();
    showPanel({ [`GET ${thread}/files#mine`]: [] });

    await pickYourChanges(user);

    expect(
      await screen.findByText(
        "Ask the assistant to change something, or open a terminal in this checkout.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Push to PR" })).not.toBeInTheDocument();
  });

  it("opens a terminal tab in the review's checkout", async () => {
    const user = userEvent.setup();
    const fetch = stubFetch({
      "POST /api/v1/code/reviews/rv1/terminal": { name: "ta-term-2" },
    });
    function Where() {
      return <p>Terminal {useLocation().search}</p>;
    }
    render(
      <MemoryRouter initialEntries={["/code/reviews/rv1"]}>
        <Routes>
          <Route path="/code/reviews/rv1" element={<OpenInTerminal review={REVIEW} />} />
          <Route path="/terminal" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "Open in terminal" }));

    expect(await screen.findByText("Terminal ?tab=ta-term-2")).toBeInTheDocument();
    expect(posts(fetch)).toEqual([["/api/v1/code/reviews/rv1/terminal", null]]);
  });
});
