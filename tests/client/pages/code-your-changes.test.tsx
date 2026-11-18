/**
 * @vitest-environment jsdom
 *
 * Changing a PR's code from its review (issue #345): the "Your changes"
 * scope shows what you or the assistant changed on top of the PR's head,
 * with Push to PR (after a confirm naming the author's branch), Post as
 * suggestions and Discard; Open in terminal opens a tab in the checkout.
 * The network is the boundary: fetch is stubbed.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { ConfirmProvider } from "@groot/ui/primitives";
import { PullDiffs } from "@/pages/code/PullDiffs";
import { ReviewPanel } from "@/pages/code/ReviewPanel";
import { OpenInTerminal, YourChangesActions } from "@/pages/code/YourChanges";
import type { PullReviewView } from "../../../apps/web/src/shared/api/code";

const REVIEW = {
  id: "rv1",
  key: "review:rv1",
  number: 7,
  author: "maria",
  headRef: "retry-webhooks",
  baseRef: "main",
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
      <PullDiffs
        review={REVIEW}
        refreshKey="1"
        diffStyle="unified"
        collapse={null}
        drawer={{ open: false, onOpenChange: () => undefined }}
        yourChanges={(done) => <YourChangesActions review={REVIEW} onChanged={done} />}
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

    // Each file's header in the column: only yours.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Fold src/b.ts" })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Fold src/a.ts" })).toBeInTheDocument();
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

describe("the light editor", () => {
  it("edits the open file in place and saves it to the checkout", async () => {
    const user = userEvent.setup();
    const fetch = showPanel({});

    await user.click(await screen.findByRole("button", { name: "Edit src/a.ts" }));
    const editor = screen.getByRole("textbox", { name: "Edit src/a.ts" });
    expect(editor).toHaveValue("b\n");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await user.clear(editor);
    await user.type(editor, "B{Enter}");
    await user.click(screen.getByRole("button", { name: "Save" }));

    const save = fetch.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(new URL(String(save?.[0]), "http://x").pathname).toBe(
      "/api/v1/code/threads/review%3Arv1/review/file",
    );
    expect(JSON.parse(String(save?.[1]?.body))).toEqual({
      path: "src/a.ts",
      original: "b\n",
      content: "B\n",
    });
    // Back to the diff once saved.
    expect(await screen.findByRole("button", { name: "Edit src/a.ts" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Edit src/a.ts" })).not.toBeInTheDocument();
  });

  it("opens the file in the highlighted code editor where the browser can measure text", async () => {
    // jsdom has no canvas, which the editor measures text with; browsers do.
    const canvas = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockImplementation(
        () => ({ font: "", measureText: (t: string) => ({ width: t.length * 7 }) }) as never,
      );
    // Its tokenizer posts to itself without a target origin, which jsdom refuses.
    const post = window.postMessage.bind(window);
    const message = vi
      .spyOn(window, "postMessage")
      .mockImplementation(((m: unknown, origin?: string) =>
        post(m, origin ?? "*")) as typeof window.postMessage);
    const user = userEvent.setup();
    showPanel({});

    await user.click(await screen.findByRole("button", { name: "Edit src/a.ts" }));
    const editor = screen.getByRole("group", { name: "Edit src/a.ts" });
    expect(editor.querySelector("diffs-container")).not.toBeNull();
    expect(screen.queryByRole("textbox", { name: "Edit src/a.ts" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    canvas.mockRestore();
    message.mockRestore();
  });

  it("cancels without saving", async () => {
    const user = userEvent.setup();
    const fetch = showPanel({});

    await user.click(await screen.findByRole("button", { name: "Edit src/a.ts" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("textbox", { name: "Edit src/a.ts" })).not.toBeInTheDocument();
    expect(fetch.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
  });
});

describe("the light editor in a coding thread", () => {
  it("saves to the thread's worktree from its Review panel", async () => {
    const user = userEvent.setup();
    const at = "/api/v1/code/threads/shelley%3At1/review";
    const fetch = stubFetch({
      [`GET ${at}/files`]: [file("README.md")],
      [`GET ${at}/file`]: { path: "README.md", oldContent: "", newContent: "helo\n" },
      [`GET ${at}/drafts`]: [],
      "GET /api/v1/code/threads/shelley%3At1/checkpoints": [],
    });
    render(
      <ConfirmProvider>
        <ReviewPanel threadId="shelley:t1" baseBranch="main" refreshKey="1" page editable />
      </ConfirmProvider>,
    );

    await user.click(await screen.findByRole("button", { name: "Edit README.md" }));
    const editor = screen.getByRole("textbox", { name: "Edit README.md" });
    await user.clear(editor);
    await user.type(editor, "hello{Enter}");
    await user.click(screen.getByRole("button", { name: "Save" }));

    const save = fetch.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(new URL(String(save?.[0]), "http://x").pathname).toBe(`${at}/file`);
    expect(JSON.parse(String(save?.[1]?.body))).toEqual({
      path: "README.md",
      original: "helo\n",
      content: "hello\n",
    });
  });
});
