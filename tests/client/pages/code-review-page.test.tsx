/**
 * A thread's Review page (`/code/<id>/review`): the thread's changes, and for
 * a project thread its pull request, each on a full-width tab instead of a
 * half-width side pane, with the way back to the thread.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { ConfirmProvider } from "@groot/ui/primitives";
import { NO_CAPABILITIES } from "@tiny-agents/code/contracts";
import { CodePage } from "@/pages/code/CodePage";
import { useCodeStore } from "@/store/code";
import type { HarnessInfo, ThreadSummary } from "@/lib/code/api";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn() }),
}));

const pulls = {
  project: null,
  branch: "feat",
  active: null,
  earlier: [],
  ahead: 2,
  spend: { usd: null, limitUsd: null },
};

vi.mock("@groot/shell/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@groot/shell/lib/api")>();
  return {
    ...original,
    apiClient: Object.assign(Object.create(original.apiClient) as typeof original.apiClient, {
      get: async (path: string) => (path.endsWith("/pr") ? pulls : []),
      post: async () => ({}),
    }),
  };
});

const shelley: HarnessInfo = {
  id: "shelley",
  kind: "shelley",
  label: "Shelley",
  status: { state: "connected" },
  capabilities: {
    ...NO_CAPABILITIES,
    workspace: { ...NO_CAPABILITIES.workspace, diffs: true },
  },
  commands: [],
};

const thread = (extra: Partial<ThreadSummary> = {}): ThreadSummary => ({
  id: "shelley:c1",
  instanceId: "shelley",
  kind: "shelley",
  nativeId: "c1",
  title: "Fix the login",
  cwd: "/work/app",
  model: "predictable",
  parentId: null,
  createdAt: "2026-11-03T10:00:00Z",
  updatedAt: "2026-11-03T10:00:00Z",
  working: false,
  archived: false,
  cursor: 0,
  ...extra,
});

function Where() {
  const { pathname, search } = useLocation();
  return <output data-testid="where">{pathname + search}</output>;
}

const renderAt = (path: string) =>
  render(
    <ConfirmProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/code/:conversationId" element={<CodePage />} />
          <Route path="/code/:conversationId/review" element={<CodePage />} />
          <Route path="/code/:conversationId/changes" element={<CodePage />} />
          <Route path="/code/:conversationId/pr" element={<CodePage />} />
        </Routes>
        <Where />
      </MemoryRouter>
    </ConfirmProvider>,
  );

describe("a thread's Review page", () => {
  beforeEach(() => {
    useCodeStore.setState({ harnesses: [shelley], statuses: {}, threads: [thread()] });
  });

  it("shows the thread's changes full width, with the way back", async () => {
    renderAt("/code/shelley%3Ac1/review");
    expect(await screen.findByRole("heading", { name: "Fix the login" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Source control" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(await screen.findByTestId("code-changes")).toBeInTheDocument();
    // No project: no pull request to review.
    expect(screen.queryByRole("tab", { name: /Pull request/ })).toBeNull();
    expect(screen.getByRole("link", { name: "Back to the thread" })).toHaveAttribute(
      "href",
      "/code/shelley%3Ac1",
    );
    // The thread itself is not on this page.
    expect(screen.queryByTestId("code-transcript")).toBeNull();
  });

  it("offers a project thread's pull request on its own tab", async () => {
    const user = userEvent.setup();
    useCodeStore.setState({
      threads: [thread({ projectId: "p1", pr: { number: 12, loop: "needs_input" } })],
    });
    renderAt("/code/shelley%3Ac1/review");
    await user.click(await screen.findByRole("tab", { name: "Pull request #12" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/code/shelley%3Ac1/review?tab=pr");
    expect(await screen.findByTestId("code-pr")).toBeInTheDocument();
    expect(screen.queryByTestId("code-changes")).toBeNull();
  });
});

describe("the right panel", () => {
  beforeEach(() => {
    useCodeStore.setState({
      harnesses: [shelley],
      statuses: {},
      threads: [thread({ projectId: "p1", pr: { number: 12, loop: "green" } })],
    });
  });

  it("holds Source control and the pull request as tabs of one panel", async () => {
    const user = userEvent.setup();
    renderAt("/code/shelley%3Ac1/changes");
    const panel = await screen.findByRole("region", { name: "Review panel" });
    expect(screen.getByRole("tab", { name: "Source control" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await user.click(screen.getByRole("tab", { name: "Pull request #12" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/code/shelley%3Ac1/pr");
    expect(await screen.findByTestId("code-pr")).toBeInTheDocument();
    expect(panel).toBeInTheDocument();

    // The header's one toggle closes it, and opens it again on the tab it was left on.
    await user.click(screen.getByRole("button", { name: "Review panel" }));
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/code\/shelley%3Ac1$/);
    expect(screen.queryByRole("region", { name: "Review panel" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Review panel" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/code/shelley%3Ac1/pr");
  });
});
