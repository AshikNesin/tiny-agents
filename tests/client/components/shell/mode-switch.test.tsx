import React from "react";
import { act, fireEvent, render as renderBare, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ConfirmProvider } from "@groot/ui/primitives";
import { NO_CAPABILITIES } from "@tiny-agents/code/contracts";
import { useCommandPaletteStore } from "@groot/shell/store/command-palette";
import { AppSidebar } from "@/components/shell/AppSidebar";
import { CodeWorkspace } from "@/pages/code/Workspace";
import { useCodeStore } from "@/store/code";
import { useBotsStore } from "@/store/bots";
import { useUiStore } from "@/store/ui";
import { sidebarCommand } from "@/components/shell/sidebar-command";
import type { HarnessInfo } from "@/lib/code/api";
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

const shelley: HarnessInfo = {
  id: "shelley",
  kind: "shelley",
  label: "Shelley",
  status: { state: "connected" },
  capabilities: NO_CAPABILITIES,
  commands: [],
  ssh: { host: null, user: null, port: null, keyFile: null },
};

function renderAt(path: string) {
  return render(
    <ConfirmProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/chats/*" element={<AppSidebar />} />
          <Route path="/tasks" element={<AppSidebar />} />
          <Route path="/code/*" element={<CodeWorkspace />} />
        </Routes>
      </MemoryRouter>
    </ConfirmProvider>,
  );
}

const modes = () => within(screen.getByRole("navigation", { name: "Mode" }));

beforeEach(() => {
  useCodeStore.setState({ harnesses: [shelley], statuses: {}, threads: [] });
  useBotsStore.setState({ bots: [] });
  useUiStore.setState({ lastPath: { chat: "/chats", code: "/code" } });
});
afterEach(() => window.localStorage.clear());

describe("the Chat/Code mode switch", () => {
  it("sits at the top of the chat sidebar with Chat current and Code one click away", () => {
    renderAt("/chats");
    expect(modes().getByRole("link", { name: "Chat" })).toHaveAttribute("aria-current", "page");
    expect(modes().getByRole("link", { name: "Code" })).toHaveAttribute("href", "/code");
    expect(
      within(screen.getByRole("navigation", { name: "Primary" })).queryByRole("link", {
        name: "Code",
      }),
    ).toBeNull();
  });

  it("sits at the top of the Code sidebar with Code current", () => {
    renderAt("/code");
    expect(modes().getByRole("link", { name: "Code" })).toHaveAttribute("aria-current", "page");
    expect(modes().getByRole("link", { name: "Chat" })).toHaveAttribute("href", "/chats");
    expect(screen.queryByRole("link", { name: /Back to/ })).toBeNull();
  });

  it("returns to the page each mode was last on", () => {
    useUiStore.setState({ lastPath: { chat: "/chats/b1", code: "/code/shelley%3Aabc" } });
    const { unmount } = renderAt("/code");
    expect(modes().getByRole("link", { name: "Chat" })).toHaveAttribute("href", "/chats/b1");
    unmount();
    renderAt("/tasks");
    expect(modes().getByRole("link", { name: "Code" })).toHaveAttribute(
      "href",
      "/code/shelley%3Aabc",
    );
  });

  it("hides the switch when no coding agent is connected", () => {
    useCodeStore.setState({ harnesses: [], statuses: {}, threads: null });
    renderAt("/chats");
    expect(screen.queryByRole("navigation", { name: "Mode" })).toBeNull();
  });

  it("lists Search as a chat nav row that opens the command palette", async () => {
    useCommandPaletteStore.setState({ open: false });
    renderAt("/chats");
    const nav = within(screen.getByRole("navigation", { name: "Primary" }));
    expect(nav.getByRole("button", { name: "Search" })).toHaveTextContent(/^Search$/);
    await userEvent.click(nav.getByRole("button", { name: "Search" }));
    expect(useCommandPaletteStore.getState().open).toBe(true);
  });

  it("folds the chat sidebar to its rail with ⌘B, like the Code sidebar", () => {
    useUiStore.setState({ collapsed: false });
    renderAt("/chats");
    fireEvent.keyDown(window, { key: "b", metaKey: true });
    expect(useUiStore.getState().collapsed).toBe(true);
    expect(screen.queryByRole("button", { name: /(Expand|Collapse) sidebar/ })).toBeNull();
    fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    expect(useUiStore.getState().collapsed).toBe(false);
  });

  it("folds the chat sidebar from the command palette's Toggle sidebar", () => {
    useUiStore.setState({ collapsed: false });
    const command = sidebarCommand("chat");
    expect(command.label).toBe("Toggle sidebar");
    act(() => command.onSelect());
    expect(useUiStore.getState().collapsed).toBe(true);
  });
});
