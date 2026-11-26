import React from "react";
import {
  act,
  fireEvent,
  render as renderBare,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { ConfirmProvider } from "@groot/ui/primitives";
import { NO_CAPABILITIES } from "@tiny-agents/code/contracts";
import { CodeWorkspace } from "@/pages/code/Workspace";
import { useCodeStore } from "@/store/code";
import { useUiStore } from "@/store/ui";
import { useCommandPaletteStore } from "@groot/shell/store/command-palette";
import type { HarnessInfo, ThreadSnapshot, ThreadSummary } from "@/lib/code/api";
import { AppQueryProvider } from "../query-provider";
import { streamAt } from "../fakes/sse";

const render = (ui: Parameters<typeof renderBare>[0]) =>
  renderBare(ui, { wrapper: AppQueryProvider });

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    message: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  }),
}));
vi.mock("@/lib/sse", async () => (await import("../fakes/sse")).sseModule);

const posts = vi.hoisted(() => [] as Array<{ path: string; body: unknown }>);
const deletes = vi.hoisted(() => [] as string[]);
const asked = vi.hoisted(() => [] as unknown[]);
const openReviews = vi.hoisted(() => [] as unknown[]);
const inboxLimit = vi.hoisted(() => ({ value: 10 }));
vi.mock("@groot/shell/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@groot/shell/lib/api")>();
  return {
    ...original,
    apiClient: Object.assign(Object.create(original.apiClient) as typeof original.apiClient, {
      get: async (path: string) =>
        path === "/code/projects"
          ? [project]
          : path === "/code/reviews/inbox"
            ? asked
            : path === "/code/reviews"
              ? openReviews
              : path === "/code/reviews/settings"
                ? {
                    repos: "all",
                    direct: true,
                    drafts: false,
                    bots: false,
                    mute: [],
                    limit: inboxLimit.value,
                  }
                : [],
      delete: async (path: string) => {
        deletes.push(path);
        return { deleted: true };
      },
      post: async (path: string, body: unknown) => {
        posts.push({ path, body });
        if (path === "/code/reviews") return { id: "rv9" };
        if (path === "/code/projects/p1/chat") return projectBot;
        if (path.endsWith("/suggest")) {
          const typed = (body as { typed?: string }).typed;
          return { suggestion: typed ? `${typed} the tests first` : "Get it merged to main" };
        }
        return path === "/code/threads" ? { threadId: "new1" } : { status: "accepted" };
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
    threads: { ...NO_CAPABILITIES.threads, archive: true, delete: true },
    workspace: { ...NO_CAPABILITIES.workspace, diffs: true },
  },
  commands: [],
  ssh: { host: null, user: null, port: null, keyFile: null },
};

const thread = (nativeId: string, extra: Partial<ThreadSummary> = {}): ThreadSummary => ({
  id: `demo:${nativeId}`,
  projectId: "p1",
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
          <Route path="/code/p/:chatProjectId" element={<CodeWorkspace />} />
          <Route path="/code/reviews/:id" element={<p>Review page</p>} />
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

const waiting = thread("a", {
  unread: true,
  status: { group: "needs-you", reason: "finished" },
});
const running = thread("bb", { working: true, status: { group: "working", reason: null } });
const reviewed = thread("ccc", {
  pr: { number: 12, loop: "watching", url: "https://x/12" },
  status: { group: "review", reason: null },
});
const done = thread("dddd", { status: { group: "done", reason: null } });
const project = {
  id: "p1",
  name: "web",
  repo: { owner: "acme", name: "web" },
  transport: "gh" as const,
  baseBranch: "main",
  checkoutPath: "/code/acme--web/checkout",
  defaultInstanceId: "demo",
  defaultModel: null,
  settings: {},
  createdAt: "2026-11-05T00:00:00Z",
};

const projectBot = vi.hoisted(() => ({
  id: "lead",
  conversationId: "c-lead",
  name: "web",
  description: "Project chat for acme/web",
  systemPrompt: "",
  modelId: "test-model",
  lastReadAt: null,
  lastActivityAt: "2026-11-05T00:00:00Z",
  lastMessagePreview: null,
  toolPermissions: {},
  skillIds: [],
  connectionIds: [],
  memoryEnabled: true,
  autoReview: false,
  yoloByDefault: false,
  browserProfile: "shared",
  projectId: "p1",
  pinnedAt: null,
  guestIds: [],
  chatStartedAt: "2026-11-05T00:00:00Z",
  memoryCapturedThrough: null,
  connectionCapabilities: [],
  createdAt: "2026-11-05T00:00:00Z",
  updatedAt: "2026-11-05T00:00:00Z",
}));

const pull = (number: number, over: Record<string, unknown> = {}) => ({
  section: "needs",
  repo: "acme/web",
  number,
  title: `PR ${number}`,
  url: `https://github.com/acme/web/pull/${number}`,
  author: "maria",
  draft: false,
  updatedAt: "2026-11-17T09:00:00Z",
  decision: null,
  lastReviewAt: null,
  projectId: "p1",
  reviewId: null,
  ...over,
});

beforeEach(() => {
  posts.length = 0;
  deletes.length = 0;
  asked.length = 0;
  openReviews.length = 0;
  inboxLimit.value = 10;
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

  it("opens the project's chat inside Code from the sidebar", async () => {
    renderAt("/code");
    fireEvent.click(await screen.findByRole("link", { name: "Project chat" }));
    expect(where()).toBe("/code/p/p1");
    await waitFor(() => expect(posts.map((p) => p.path)).toContain("/code/projects/p1/chat"));
    expect(await screen.findByPlaceholderText("Message web")).toBeInTheDocument();
  });

  it("the project chat's menu button goes back to the thread list", async () => {
    renderAt("/code/p/p1");
    fireEvent.click(await screen.findByRole("button", { name: "Open menu" }));
    expect(where()).toBe("/code");
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

  it("1 opens the Changes pane and backslash closes it", async () => {
    renderAt("/code/t/demo%3Adddd");
    open(done);
    expect(screen.queryByTestId("code-pane")).toBeNull();
    await waitFor(() => {
      press("1");
      expect(screen.getByRole("tab", { name: /Changes/ })).toHaveAttribute("aria-selected", "true");
    });
    press("\\");
    expect(screen.queryByTestId("code-pane")).toBeNull();
    press("\\");
    expect(screen.getByTestId("code-pane")).toBeInTheDocument();
  });

  it("on a phone a thread opens on the thread, and the pane waits to be asked for", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(max-width: 1023px)",
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    useUiStore.setState({ codePane: "changes" });
    renderAt(`/code/t/${encodeURIComponent(waiting.id)}`);
    open(waiting);

    await screen.findByText("web /");
    expect(screen.queryByTestId("code-pane")).toBeNull();
    await waitFor(() => {
      press("1");
      expect(screen.getByTestId("code-pane")).toBeInTheDocument();
    });
    vi.unstubAllGlobals();
  });

  it("the composer says what Enter does while the agent works", () => {
    renderAt("/code/t/demo%3Abb");
    open(running);
    expect(screen.getByTestId("code-composer-hint")).toHaveTextContent(
      "Enter steers · Alt+Enter queues · Esc stops",
    );
  });

  it("n opens the new thread dialog; Enter starts the thread in the remembered project", async () => {
    renderAt("/code");
    press("n");
    expect(where()).toBe("/code/new");
    const box = await screen.findByRole("textbox", { name: "What should the agent do?" });
    await screen.findByText("web");
    fireEvent.change(box, { target: { value: "Fix the login callback" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(where()).toBe("/code/t/new1"));
    expect(posts.find((post) => post.path === "/code/threads")?.body).toMatchObject({
      projectId: "p1",
      instanceId: "demo",
      message: "Fix the login callback",
    });
  });

  it("shows the reason a thread needs you beside its title, but not a plain finish", () => {
    useCodeStore.setState({
      threads: [waiting, thread("asks", { status: { group: "needs-you", reason: "asks you" } })],
    });
    renderAt("/code");
    expect(document.querySelector('[data-thread="demo:asks"]')).toHaveTextContent("asks you");
    expect(document.querySelector('[data-thread="demo:a"]')).toHaveTextContent(/^Thread a$/);
  });

  it("says who started a thread when you point at it", () => {
    useCodeStore.setState({
      threads: [thread("a", { startedBy: { botId: "b1", name: "Ada", project: false } })],
    });
    renderAt("/code");
    expect(document.querySelector('[data-thread="demo:a"]')).toHaveAttribute(
      "title",
      "Started by Ada",
    );
  });

  it("? lists the workspace's keys, and a thread's own while one is open", async () => {
    renderAt("/code");
    press("?", { shiftKey: true });
    expect(screen.getByTestId("code-keys")).toHaveTextContent("Next thread that needs you");
    expect(screen.getByTestId("code-keys")).not.toHaveTextContent("Stop the agent");
  });

  it("? lists a thread's keys beside the workspace's while the thread is open", async () => {
    renderAt("/code/t/demo%3Adddd");
    open(done);
    await screen.findByText("web /");
    press("?", { shiftKey: true });
    const keys = screen.getByTestId("code-keys");
    expect(keys).toHaveTextContent("Next thread that needs you");
    expect(keys).toHaveTextContent("Stop the agent");
  });

  it("4 opens the terminal as the work pane's fourth tab, after Files", async () => {
    renderAt("/code/t/demo%3Adddd");
    open(done);
    await screen.findByText("web /");
    press("4");
    const tabs = screen.getAllByRole("tab").map((tab) => tab.textContent);
    expect(tabs).toEqual(["Changes1", "Pull request2", "Files3", "Terminal4"]);
    expect(screen.getByRole("tab", { name: /Terminal/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("code-pane")).toContainElement(screen.getByTestId("code-terminal"));
  });

  it("z widens the work pane over the thread list and the thread, and z again puts it back", async () => {
    renderAt("/code/t/demo%3Adddd");
    open(done);
    await screen.findByText("web /");
    press("3");
    const thread = document.querySelector("main")!;
    const list = document.querySelector("#code-sidebar")!;
    expect(thread).not.toHaveAttribute("hidden");
    press("z");
    expect(thread).toHaveAttribute("hidden");
    expect(list).toHaveAttribute("hidden");
    expect(screen.getByRole("button", { name: "Restore the work pane" })).toBeInTheDocument();
    press("z");
    expect(thread).not.toHaveAttribute("hidden");
    fireEvent.click(screen.getByRole("button", { name: "Widen the work pane" }));
    expect(thread).toHaveAttribute("hidden");
    press("\\");
    expect(thread).not.toHaveAttribute("hidden");
  });

  it(": opens the app's command palette, the one menu for every command", async () => {
    useCommandPaletteStore.setState({ open: false });
    renderAt("/code/t/demo%3Adddd");
    open(done);
    await screen.findByText("web /");
    press(":", { shiftKey: true });
    expect(useCommandPaletteStore.getState().open).toBe(true);
    expect(screen.queryByRole("dialog", { name: "Commands" })).toBeNull();
  });

  it("right-clicking a thread offers Open PR, Archive and Delete", async () => {
    renderAt("/code");
    fireEvent.contextMenu(document.querySelector('[data-thread="demo:ccc"]')!);
    const menu = await screen.findByRole("menu");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["Open PR #12", "Archive", "Delete"]);
    expect(within(menu).getByRole("menuitem", { name: "Open PR #12" })).toHaveAttribute(
      "href",
      "https://x/12",
    );
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Archive" }));
    await waitFor(() =>
      expect(posts).toContainEqual({
        path: "/code/threads/demo%3Accc/archive",
        body: { archived: true },
      }),
    );

    fireEvent.contextMenu(document.querySelector('[data-thread="demo:a"]')!);
    const second = await screen.findByRole("menu");
    expect(within(second).queryByRole("menuitem", { name: /Open PR/ })).toBeNull();
    fireEvent.click(within(second).getByRole("menuitem", { name: "Delete" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deletes).toEqual(["/code/threads/demo%3Aa"]));
  });

  it("suggests the next message after a turn, Tab takes it, and typing asks for a completion", async () => {
    renderAt("/code/t/demo%3Adddd");
    streamAt(`/api/v1/code/threads/${encodeURIComponent(done.id)}/events`).send({
      type: "snapshot",
      snapshot: {
        ...snapshot(done),
        items: [
          { kind: "user", id: "u1", text: "Add a thread menu", attachments: [] },
          { kind: "assistant", id: "a1", text: "Pushed. Want me to open the PR and merge it?" },
        ],
      },
    });
    const ghost = await screen.findByTestId("code-composer-suggestion");
    expect(ghost).toHaveTextContent("Get it merged to main");
    const suggested = posts.find((post) => post.path.endsWith("/suggest"));
    expect(suggested?.body).toEqual({
      user: "Add a thread menu",
      agent: "Pushed. Want me to open the PR and merge it?",
    });

    const box = screen.getByTestId("code-composer");
    fireEvent.change(box, { target: { value: "Get it" } });
    expect(screen.getByTestId("code-composer-suggestion")).toHaveTextContent(/^merged to main/);
    fireEvent.keyDown(box, { key: "Tab" });
    expect(box).toHaveValue("Get it merged to main");

    fireEvent.change(box, { target: { value: "run" } });
    await waitFor(
      () =>
        expect(screen.getByTestId("code-composer-suggestion")).toHaveTextContent(
          /^the tests first/,
        ),
      { timeout: 3000 },
    );
    expect(posts.filter((post) => post.path.endsWith("/suggest"))).toHaveLength(2);
  });

  it("a thread link lands on the thread", () => {
    renderAt("/code/t/demo%3Adddd");
    expect(where()).toBe("/code/t/demo%3Adddd");
  });
});

describe("reviews in the thread list", () => {
  it("lists the pull requests that wait for your review, once each, and opens one", async () => {
    asked.push(
      pull(1, { reviewId: "rv1" }),
      pull(2, { section: "updated" }),
      pull(3, { section: "waiting" }),
      pull(4, { section: "mine" }),
      pull(5, { repo: "other/lib", url: "https://github.com/other/lib/pull/5", projectId: null }),
    );
    openReviews.push(
      {
        id: "rv1",
        number: 1,
        title: "PR 1",
        repo: "acme/web",
        author: "maria",
        url: "https://github.com/acme/web/pull/1",
      },
      {
        id: "rv8",
        number: 8,
        title: "PR 8",
        repo: "acme/api",
        author: "li",
        url: "https://github.com/acme/api/pull/8",
      },
    );
    renderAt("/code");

    const reviews = await screen.findByRole("region", { name: "Reviews" });
    await waitFor(() =>
      expect(
        [...reviews.querySelectorAll("[data-testid=code-review-row]")].map((row) =>
          row.textContent?.replace(/\s+/g, " ").trim(),
        ),
      ).toEqual(["#1PR 1", "#2PR 2updated", "#5PR 5", "#8PR 8"]),
    );
    expect(screen.getByRole("link", { name: "Open #5 PR 5 on GitHub" })).toHaveAttribute(
      "href",
      "https://github.com/other/lib/pull/5",
    );

    fireEvent.click(screen.getByRole("button", { name: "Review #2 PR 2" }));

    expect(await screen.findByText("Review page")).toBeInTheDocument();
    expect(posts).toEqual([
      { path: "/code/reviews", body: { pr: "https://github.com/acme/web/pull/2" } },
    ]);
  });

  it("shows only as many requests as Settings allows, and the rest on request", async () => {
    inboxLimit.value = 2;
    asked.push(pull(1), pull(2), pull(3), pull(4));
    renderAt("/code");

    const reviews = await screen.findByRole("region", { name: "Reviews" });
    const rows = () => reviews.querySelectorAll("[data-testid=code-review-row]").length;
    const more = await screen.findByRole("button", { name: "2 more" });
    expect(rows()).toBe(2);
    expect(screen.getByRole("link", { name: "Review list filters" })).toHaveAttribute(
      "href",
      "/settings/reviews",
    );

    fireEvent.click(more);

    expect(rows()).toBe(4);
    expect(screen.queryByRole("button", { name: /more$/ })).not.toBeInTheDocument();
  });

  it("opens a pasted pull request with the v key", async () => {
    renderAt("/code");
    await screen.findByRole("region", { name: "Reviews" });

    press("v");
    const link = screen.getByRole("textbox", { name: "Pull request to review" });
    fireEvent.change(link, { target: { value: "acme/web#7" } });
    fireEvent.submit(link);

    expect(await screen.findByText("Review page")).toBeInTheDocument();
    expect(posts).toEqual([{ path: "/code/reviews", body: { pr: "acme/web#7" } }]);
  });
});
