import React from "react";
import { act, fireEvent, render as renderBare, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { ConfirmProvider } from "@groot/ui/primitives";
import { NO_CAPABILITIES } from "@tiny-agents/code/contracts";
import { CodeWorkspace, LegacyThreadRedirect } from "@/pages/code/Workspace";
import { useCodeStore } from "@/store/code";
import { useUiStore } from "@/store/ui";
import type { HarnessInfo, ThreadSnapshot, ThreadSummary } from "@/lib/code/api";
import { AppQueryProvider } from "../query-provider";
import { streamAt } from "../fakes/sse";

const render = (ui: Parameters<typeof renderBare>[0]) =>
  renderBare(ui, { wrapper: AppQueryProvider });

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn() }),
}));
vi.mock("@/lib/sse", async () => (await import("../fakes/sse")).sseModule);

const posts = vi.hoisted(() => [] as Array<{ path: string; body: unknown }>);
vi.mock("@groot/shell/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@groot/shell/lib/api")>();
  return {
    ...original,
    apiClient: Object.assign(Object.create(original.apiClient) as typeof original.apiClient, {
      get: async () => [],
      post: async (path: string, body: unknown) => {
        posts.push({ path, body });
        return { status: "accepted" };
      },
    }),
  };
});

const agent: HarnessInfo = {
  id: "demo",
  kind: "demo",
  label: "Demo agent",
  status: { state: "connected" },
  capabilities: {
    ...NO_CAPABILITIES,
    turns: { ...NO_CAPABILITIES.turns, interrupt: true, steer: true, queue: true },
    workspace: { ...NO_CAPABILITIES.workspace, diffs: true },
  },
  commands: [],
};

const thread = (nativeId: string, extra: Partial<ThreadSummary> = {}): ThreadSummary => ({
  id: `demo:${nativeId}`,
  instanceId: "demo",
  kind: "demo",
  nativeId,
  title: `Thread ${nativeId}`,
  cwd: "/repo",
  model: null,
  parentId: null,
  createdAt: "2026-11-05T00:00:00Z",
  updatedAt: `2026-11-05T00:0${nativeId.length}:00Z`,
  working: false,
  archived: false,
  cursor: 1,
  ...extra,
});

const snapshot = (summary: ThreadSummary): ThreadSnapshot => ({
  thread: summary,
  items: [{ kind: "user", id: "u1", text: "Fix the login callback", attachments: [] }],
  settings: { model: null, effort: null, permissionMode: null },
  queued: [],
  jobs: [],
  children: [],
  context: { used: 0 },
  costUsd: 0,
});

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}

const renderAt = (path: string) =>
  render(
    <ConfirmProvider>
      <MemoryRouter initialEntries={[path]}>
        <Where />
        <Routes>
          <Route path="/code" element={<CodeWorkspace />} />
          <Route path="/code/new" element={<CodeWorkspace />} />
          <Route path="/code/t/:threadId" element={<CodeWorkspace />} />
          <Route path="/code/:conversationId" element={<LegacyThreadRedirect />} />
          <Route path="/code/:conversationId/pr" element={<LegacyThreadRedirect />} />
        </Routes>
      </MemoryRouter>
    </ConfirmProvider>,
  );

const where = () => screen.getByTestId("where").textContent;
const press = (key: string, init: KeyboardEventInit = {}) =>
  act(() => {
    fireEvent.keyDown(document.body, { key, ...init });
  });
const open = (summary: ThreadSummary) =>
  streamAt(`/api/v1/code/threads/${encodeURIComponent(summary.id)}/events`).send({
    type: "snapshot",
    snapshot: snapshot(summary),
  });

const waiting = thread("a", { unread: true });
const running = thread("bb", { working: true });
const reviewed = thread("ccc", { pr: { number: 12, loop: "watching", url: "https://x/12" } });
const done = thread("dddd");

beforeEach(() => {
  posts.length = 0;
  useUiStore.setState({ codeSidebarOpen: true, codePane: null, lastCodePane: "changes" });
  useCodeStore.setState({
    harnesses: [agent],
    statuses: {},
    threads: [done, reviewed, running, waiting],
  });
});
afterEach(() => window.localStorage.clear());

describe("the Code workspace", () => {
  it("lists threads by status, the ones that need you first", () => {
    renderAt("/code");
    const list = screen.getByRole("navigation", { name: "Threads" });
    const sections = [...list.querySelectorAll("section[aria-label]")].map((section) => [
      section.getAttribute("aria-label"),
      [...section.querySelectorAll("[data-thread]")].map((row) => row.getAttribute("data-thread")),
    ]);
    expect(sections.slice(0, 4)).toEqual([
      ["Needs you", ["demo:a"]],
      ["Working", ["demo:bb"]],
      ["In review", ["demo:ccc"]],
      ["Done", ["demo:dddd"]],
    ]);
  });

  it("j and k walk the list in the order it is shown", () => {
    renderAt("/code");
    press("j");
    expect(where()).toBe("/code/t/demo%3Aa");
    press("j");
    expect(where()).toBe("/code/t/demo%3Abb");
    press("k");
    expect(where()).toBe("/code/t/demo%3Aa");
  });

  it("u jumps to the next thread that needs you", () => {
    renderAt("/code/t/demo%3Adddd");
    press("u");
    expect(where()).toBe("/code/t/demo%3Aa");
  });

  it("a letter typed into the composer is text, not a command", () => {
    renderAt("/code/t/demo%3Adddd");
    open(done);
    const composer = screen.getByRole("textbox", { name: "Message Demo agent" });
    composer.focus();
    fireEvent.keyDown(composer, { key: "j" });
    expect(where()).toBe("/code/t/demo%3Adddd");
  });

  it("c focuses the composer and Escape leaves it", () => {
    renderAt("/code/t/demo%3Adddd");
    open(done);
    const composer = screen.getByRole("textbox", { name: "Message Demo agent" });
    press("c");
    expect(document.activeElement).toBe(composer);
    fireEvent.keyDown(composer, { key: "Escape" });
    expect(document.activeElement).not.toBe(composer);
  });

  it("Escape stops a working agent", async () => {
    renderAt("/code/t/demo%3Abb");
    open(running);
    press("Escape");
    await waitFor(() =>
      expect(posts.map((post) => post.path)).toContain("/code/threads/demo%3Abb/interrupt"),
    );
  });

  it("Escape does not stop an idle agent", () => {
    renderAt("/code/t/demo%3Adddd");
    open(done);
    press("Escape");
    expect(posts.filter((post) => post.path.endsWith("/interrupt"))).toEqual([]);
  });

  it("1 opens the Changes pane and backslash closes it", () => {
    renderAt("/code/t/demo%3Adddd");
    open(done);
    expect(screen.queryByTestId("code-pane")).toBeNull();
    press("1");
    expect(screen.getByRole("tab", { name: /Changes/ })).toHaveAttribute("aria-selected", "true");
    press("\\");
    expect(screen.queryByTestId("code-pane")).toBeNull();
    press("\\");
    expect(screen.getByTestId("code-pane")).toBeInTheDocument();
  });

  it("the composer says what Enter does while the agent works", () => {
    renderAt("/code/t/demo%3Abb");
    open(running);
    expect(screen.getByTestId("code-composer-hint")).toHaveTextContent(
      "Enter steers · Alt+Enter queues · Esc stops",
    );
  });

  it("? lists every key", () => {
    renderAt("/code");
    press("?", { shiftKey: true });
    const keys = screen.getByTestId("code-keys");
    expect(keys).toHaveTextContent("Next thread that needs you");
    expect(keys).toHaveTextContent("Stop the agent");
  });

  it("an old thread link lands on the thread with its pane", () => {
    renderAt("/code/demo%3Adddd/pr");
    expect(where()).toBe("/code/t/demo%3Adddd");
    expect(useUiStore.getState().codePane).toBe("pr");
  });
});
