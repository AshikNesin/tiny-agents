import React from "react";
import { fireEvent, render as renderBare, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { ConfirmProvider } from "@groot/ui/primitives";
import { NO_CAPABILITIES } from "@tiny-agents/code/contracts";
import { CodePage } from "@/pages/code/CodePage";
import { useCodeStore } from "@/store/code";
import type { HarnessInfo, ThreadSummary } from "@/lib/code/api";
import { AppQueryProvider } from "../query-provider";

const render = (ui: Parameters<typeof renderBare>[0]) =>
  renderBare(ui, { wrapper: AppQueryProvider });

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

let archivedRows: ThreadSummary[] = [];

vi.mock("@groot/shell/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@groot/shell/lib/api")>();
  return {
    ...original,
    apiClient: Object.assign(Object.create(original.apiClient) as typeof original.apiClient, {
      get: async (path: string, params?: { view?: string }) =>
        path.endsWith("/pr")
          ? pulls
          : path.endsWith("/threads") && params?.view === "archived"
            ? archivedRows
            : [],
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
    expect(screen.queryByRole("tab", { name: /Pull request/ })).toBeNull();
    expect(screen.getByRole("link", { name: "Back to the thread" })).toHaveAttribute(
      "href",
      "/code/shelley%3Ac1",
    );
    expect(screen.queryByTestId("code-transcript")).toBeNull();
  });

  it("offers a project thread's pull request on its own tab", async () => {
    const user = userEvent.setup();
    useCodeStore.setState({
      threads: [
        thread({
          projectId: "p1",
          pr: { number: 12, loop: "needs_input", url: "https://github.com/acme/web/pull/12" },
        }),
      ],
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
      threads: [
        thread({
          projectId: "p1",
          pr: { number: 12, loop: "green", url: "https://github.com/acme/web/pull/12" },
        }),
      ],
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

    await user.click(screen.getByRole("button", { name: "Review panel" }));
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/code\/shelley%3Ac1$/);
    expect(screen.queryByRole("region", { name: "Review panel" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Review panel" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/code/shelley%3Ac1/pr");
  });

  it("opens the pull request on GitHub straight from the header", async () => {
    const url = "https://github.com/acme/web/pull/12";
    useCodeStore.setState({
      threads: [thread({ projectId: "p1", pr: { number: 12, loop: "green", url } })],
    });
    renderAt("/code/shelley%3Ac1");
    const link = await screen.findByRole("link", { name: "Open pull request #12 on GitHub" });
    expect(link).toHaveAttribute("href", url);
    expect(link).toHaveAttribute("target", "_blank");
    expect(screen.getByRole("button", { name: "Review panel" })).toBeInTheDocument();
  });

  describe("resizing", () => {
    afterEach(() => window.localStorage.clear());
    const divider = () => screen.getByRole("separator", { name: "Resize review panel" });
    const panelWidth = () =>
      screen.getByRole("region", { name: "Review panel" }).style.getPropertyValue("--review-width");

    it("resizes from the keyboard within its limits, and remembers the width", async () => {
      const { unmount } = renderAt("/code/shelley%3Ac1/changes");
      await screen.findByRole("region", { name: "Review panel" });
      expect(panelWidth()).toBe("");

      fireEvent.keyDown(divider(), { key: "Home" });
      expect(divider()).toHaveAttribute("aria-valuenow", "320");
      fireEvent.keyDown(divider(), { key: "ArrowLeft" });
      expect(divider()).toHaveAttribute("aria-valuenow", "336");
      expect(panelWidth()).toBe("336px");
      fireEvent.keyDown(divider(), { key: "ArrowRight", shiftKey: true });
      expect(divider()).toHaveAttribute("aria-valuenow", "320");
      fireEvent.keyDown(divider(), { key: "End" });
      expect(divider()).toHaveAttribute("aria-valuenow", "664");
      expect(divider()).toHaveAttribute("aria-valuemin", "320");
      expect(divider()).toHaveAttribute("aria-valuemax", "664");

      unmount();
      renderAt("/code/shelley%3Ac1/changes");
      await screen.findByRole("region", { name: "Review panel" });
      expect(panelWidth()).toBe("664px");
    });

    it("goes back to its default width on double-click", async () => {
      window.localStorage.setItem("code:review-width", "500");
      const { unmount } = renderAt("/code/shelley%3Ac1/changes");
      await screen.findByRole("region", { name: "Review panel" });
      expect(panelWidth()).toBe("500px");

      fireEvent.doubleClick(divider());
      expect(panelWidth()).toBe("");
      unmount();
      renderAt("/code/shelley%3Ac1/changes");
      await screen.findByRole("region", { name: "Review panel" });
      expect(panelWidth()).toBe("");
    });
  });
});

describe("an archived project thread (#383)", () => {
  afterEach(() => {
    archivedRows = [];
  });

  it("keeps its Pull request tab once a merge archived it out of the active list", async () => {
    archivedRows = [thread({ archived: true, projectId: "p1" })];
    useCodeStore.setState({ harnesses: [shelley], statuses: {}, threads: [] });
    renderAt("/code/shelley%3Ac1/pr");
    expect(await screen.findByTestId("code-pr")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Pull request/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});
