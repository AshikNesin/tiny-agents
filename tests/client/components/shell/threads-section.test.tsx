import React from "react";
import { fireEvent, render as renderBare, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { ConfirmProvider } from "@groot/ui/primitives";
import { NO_CAPABILITIES } from "@tiny-agents/code/contracts";
import { AppSidebar } from "@/components/shell/AppSidebar";
import { useCodeStore } from "@/store/code";
import { useBotsStore } from "@/store/bots";
import { usePeopleStore } from "@/store/people";
import { useUiStore } from "@/store/ui";
import type { BotListEntry } from "../../../../apps/web/src/shared/api/bots";
import type { HarnessInfo, ThreadSummary } from "@/lib/code/api";
import { AppQueryProvider } from "../../query-provider";

const render = (ui: Parameters<typeof renderBare>[0]) =>
  renderBare(ui, { wrapper: AppQueryProvider });

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn() }),
}));

vi.mock("@groot/shell/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@groot/shell/lib/api")>();
  return {
    ...original,
    apiClient: Object.assign(Object.create(original.apiClient) as typeof original.apiClient, {
      get: async () => [],
      post: async () => ({}),
    }),
  };
});

const agent: HarnessInfo = {
  id: "demo",
  kind: "demo",
  label: "Demo agent",
  status: { state: "connected" },
  capabilities: NO_CAPABILITIES,
  commands: [],
  ssh: { host: null, user: null, port: null, keyFile: null },
};

const thread = (nativeId: string, extra: Partial<ThreadSummary> = {}): ThreadSummary => ({
  id: nativeId,
  projectId: "p1",
  instanceId: "demo",
  kind: "demo",
  nativeId,
  title: `Thread ${nativeId}`,
  cwd: null,
  model: null,
  parentId: null,
  createdAt: "2026-11-05T00:00:00Z",
  updatedAt: "2026-11-05T00:00:00Z",
  working: false,
  archived: false,
  cursor: 1,
  ...extra,
});

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}

const renderSidebar = () =>
  render(
    <ConfirmProvider>
      <MemoryRouter initialEntries={["/chats"]}>
        <Where />
        <Routes>
          <Route path="*" element={<AppSidebar />} />
        </Routes>
      </MemoryRouter>
    </ConfirmProvider>,
  );

beforeEach(() => {
  usePeopleStore.setState({ role: "owner" });
  useBotsStore.setState({ bots: [] });
  useCodeStore.setState({
    harnesses: [agent],
    statuses: {},
    threads: [
      thread("merged", { status: { group: "done", reason: "merged" } }),
      thread("fix", {
        working: true,
        status: { group: "working", reason: null },
        startedBy: { botId: "b1", name: "Ada", project: false },
      }),
      thread("asks", { status: { group: "needs-you", reason: "asks you" } }),
      thread("lead", {
        working: true,
        status: { group: "working", reason: null },
        startedBy: { botId: "b2", name: "web", project: true },
      }),
    ],
  });
});
afterEach(() => {
  usePeopleStore.setState(usePeopleStore.getInitialState());
  useUiStore.setState({ foldedSections: [] });
  window.localStorage.clear();
});

describe("threads in the chat sidebar", () => {
  it("lists the threads that need you or still work, and who started each", () => {
    renderSidebar();
    const section = within(screen.getByRole("region", { name: "Threads" }));
    expect(section.getAllByRole("link").map((link) => link.textContent)).toEqual([
      "All threads",
      "Thread asksasks you",
      "Thread fix, started by AdaYesterday",
      "Thread lead, started by web chatYesterday",
    ]);
  });

  it("lists project chats in their own Projects section, above Threads, not under Bots", () => {
    const bot = (id: string, name: string, projectId: string | null): BotListEntry => ({
      id,
      conversationId: `c-${id}`,
      name,
      description: "",
      modelId: "m",
      lastMessagePreview: null,
      lastActivityAt: "2026-11-05T00:00:00.000Z",
      lastReadAt: null,
      unread: false,
      replying: false,
      approvals: 0,
      questions: 0,
      pinnedAt: null,
      projectId,
    });
    useBotsStore.setState({ bots: [bot("b1", "Ada", null), bot("b2", "web", "p1")] });
    renderSidebar();
    const regions = screen.getAllByRole("region").map((r) => r.getAttribute("aria-label"));
    expect(regions).toEqual(["Projects", "Threads", "Bots"]);
    const projects = within(screen.getByRole("region", { name: "Projects" }));
    fireEvent.click(projects.getByRole("link", { name: "web" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/chats/b2");
    const bots = within(screen.getByRole("region", { name: "Bots" }));
    expect(bots.queryByText("web")).toBeNull();
    expect(bots.getByText("Ada")).toBeVisible();
  });

  it("folds and unfolds from its heading", () => {
    renderSidebar();
    const section = within(screen.getByRole("region", { name: "Threads" }));
    const heading = section.getByRole("button", { name: "Threads" });
    fireEvent.click(heading);
    expect(heading).toHaveAttribute("aria-expanded", "false");
    expect(section.queryByRole("link", { name: /Thread fix/ })).toBeNull();
    fireEvent.click(heading);
    expect(section.getByRole("link", { name: /Thread fix/ })).toBeVisible();
  });

  it("opens a thread in Code, and All threads opens the Code list", () => {
    renderSidebar();
    const section = within(screen.getByRole("region", { name: "Threads" }));
    fireEvent.click(section.getByRole("link", { name: /Thread fix/ }));
    expect(screen.getByTestId("where")).toHaveTextContent("/code/t/fix");
    fireEvent.click(section.getByRole("link", { name: "All threads" }));
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/code$/);
  });

  it("is not shown to a guest", () => {
    usePeopleStore.setState({ role: "guest" });
    renderSidebar();
    expect(screen.queryByRole("region", { name: "Threads" })).toBeNull();
  });

  it("is not there when no coding agent is connected", () => {
    useCodeStore.setState({ harnesses: [] });
    renderSidebar();
    expect(screen.queryByRole("region", { name: "Threads" })).toBeNull();
  });
});
