/**
 * @vitest-environment jsdom
 *
 * A PR review's assistant before its first question (issue #345): the
 * model it starts on is picked beside the box, the project's default
 * first. The network is the boundary: fetch is stubbed.
 */
import { render as renderBare, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { MemoryRouter } from "react-router-dom";
import { ConfirmProvider } from "@groot/ui/primitives";
import { PullReview } from "@/pages/code/PullReview";
import type { PullReviewView } from "../../../apps/web/src/shared/api/code";
import { AppQueryProvider } from "../query-provider";

const render = (ui: Parameters<typeof renderBare>[0]) =>
  renderBare(ui, { wrapper: AppQueryProvider });

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
  assistant: { instanceId: "claude-code", model: "sonnet" },
  archived: false,
  brief: null,
  reviewing: false,
  findings: [],
  updatedAt: "2026-11-17T00:00:00.000Z",
} satisfies PullReviewView;

function stubFetch() {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const path = new URL(String(url), "http://x").pathname;
    const data =
      path === "/api/v1/code/reviews/rv1" && (init?.method ?? "GET") === "GET"
        ? REVIEW
        : path.endsWith("/models")
          ? [
              { id: "sonnet", label: "Sonnet", isDefault: true },
              { id: "opus", label: "Opus" },
            ]
          : path.endsWith("/threads")
            ? { headSha: REVIEW.headSha, threads: [] }
            : path.endsWith("/ask")
              ? { threadId: "claude-code:t1" }
              : [];
    return new Response(JSON.stringify({ success: true, data }), {
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => vi.unstubAllGlobals());

describe("the review assistant's model", () => {
  it("starts on the model picked beside the first question", async () => {
    const user = userEvent.setup();
    const fetch = stubFetch();
    render(
      <MemoryRouter>
        <ConfirmProvider>
          <PullReview reviewId="rv1" harnesses={[]} rows={[]} />
        </ConfirmProvider>
      </MemoryRouter>,
    );

    const picker = await screen.findByRole("button", { name: "Model" });
    expect(picker).toHaveTextContent("Sonnet");
    await user.click(picker);
    await user.click(await screen.findByRole("option", { name: /Opus/ }));
    await user.type(screen.getByRole("textbox", { name: "Ask the assistant" }), "What breaks?");
    await user.click(screen.getByRole("button", { name: "Ask" }));

    const ask = fetch.mock.calls.find(([url]) => String(url).endsWith("/reviews/rv1/ask"));
    expect(JSON.parse(String(ask?.[1]?.body))).toEqual({ message: "What breaks?", model: "opus" });
  });
});
