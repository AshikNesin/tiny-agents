import React from "react";
import { fireEvent, render as renderBare, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ConfirmProvider } from "@groot/ui/primitives";
import { NO_CAPABILITIES } from "@tiny-agents/code/contracts";
import { CodePage } from "@/pages/code/CodePage";
import { useCodeStore } from "@/store/code";
import type { HarnessInfo } from "@/lib/code/api";
import { AppQueryProvider } from "../query-provider";

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
};

const renderPage = () =>
  render(
    <ConfirmProvider>
      <MemoryRouter initialEntries={["/code/new"]}>
        <Routes>
          <Route path="/code/new" element={<CodePage />} />
        </Routes>
      </MemoryRouter>
    </ConfirmProvider>,
  );

beforeEach(() => {
  useCodeStore.setState({ harnesses: [shelley], statuses: {}, threads: [] });
});
afterEach(() => window.localStorage.clear());

const sidebar = () => screen.getByRole("complementary", { name: "Threads" });

describe("the Code sidebar", () => {
  it("hides and shows the thread list, and remembers it", async () => {
    const user = userEvent.setup();
    const { unmount } = renderPage();
    expect(sidebar()).toHaveAttribute("data-state", "open");

    await user.click(screen.getByRole("button", { name: "Hide sidebar" }));
    expect(sidebar()).toHaveAttribute("data-state", "closed");
    const show = screen.getByRole("button", { name: "Show sidebar" });
    expect(show).toHaveAttribute("aria-expanded", "false");

    unmount();
    renderPage();
    expect(sidebar()).toHaveAttribute("data-state", "closed");
    await user.click(screen.getByRole("button", { name: "Show sidebar" }));
    expect(sidebar()).toHaveAttribute("data-state", "open");
    expect(screen.queryByRole("button", { name: "Show sidebar" })).toBeNull();
  });

  it("toggles with ⌘B", () => {
    renderPage();
    fireEvent.keyDown(window, { key: "b", metaKey: true });
    expect(sidebar()).toHaveAttribute("data-state", "closed");
    fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    expect(sidebar()).toHaveAttribute("data-state", "open");
  });
});
