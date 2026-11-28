import React from "react";
import userEvent from "@testing-library/user-event";
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
import { OpenProjectChat } from "@/pages/code/ProjectChat";
import { useCodeStore } from "@/store/code";
import { useUiStore } from "@/store/ui";
import { useCommandPaletteStore } from "@groot/shell/store/command-palette";
import type { HarnessInfo, ModelOption, ThreadSnapshot, ThreadSummary } from "@/lib/code/api";
import type { Bot, BotListEntry } from "../../../apps/web/src/shared/api/bots";
import type {
  CheckpointView,
  InboxPullView,
  ProjectView,
  PullReviewView,
  ReviewFile,
  ReviewInboxSettings,
  ReviewTerminal,
  ThreadPullsView,
} from "../../../apps/web/src/shared/api/code";
import type { Deleted } from "../../../apps/web/src/shared/api/common";
import { fakeApi } from "../fakes/api";
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

let api: ReturnType<typeof fakeApi>;
const asked: InboxPullView[] = [];
const openReviews: PullReviewView[] = [];
const inboxLimit = { value: 10 };
const more: { projects: ProjectView[]; creating: Promise<{ threadId: string }> | null } = {
  projects: [],
  creating: null,
};
const posts = () =>
  api.requests
    .filter((request) => request.method === "POST")
    .map(({ path, body }) => ({ path, body }));
const deletes = () =>
  api.requests.filter((request) => request.method === "DELETE").map((request) => request.path);

function serve() {
  api = fakeApi();
  api.get("/code/projects", () => [project, ...more.projects]);
  api.get("/code/reviews/inbox", () => asked);
  api.get("/code/reviews", () => openReviews);
  api.get("/code/reviews/settings", (): ReviewInboxSettings => ({
    repos: "all",
    direct: true,
    drafts: false,
    bots: false,
    mute: [],
    limit: inboxLimit.value,
  }));
  api.get("/bots", (): BotListEntry[] => []);
  api.get("/code/harnesses/:instanceId/models", (): ModelOption[] => []);
  api.get("/code/threads/:id", ({ params }) =>
    snapshot({ ...thread(params.id!), id: decodeURIComponent(params.id!) }),
  );
  api.get("/code/threads/:id/checkpoints", (): CheckpointView[] => []);
  api.get("/code/threads/:id/review/files", (): ReviewFile[] => []);
  api.get("/code/threads/:id/files", (): string[] => []);
  api.get("/code/threads/:id/pr", (): ThreadPullsView => ({
    project,
    branch: "ta/fix",
    active: null,
    earlier: [],
    ahead: 0,
    uncommitted: 0,
    landed: null,
  }));
  api.post("/code/threads/:id/seen", () => ({ status: "accepted" }));
  api.post("/code/threads/:id/interrupt", () => ({ status: "accepted" }));
  api.post("/code/threads/:id/archive", ({ params }) => ({
    moved: [decodeURIComponent(params.id!)],
  }));
  api.post("/code/threads/:id/terminal", (): ReviewTerminal => ({ name: "ta-term-1" }));
  api.delete("/code/threads/:id", (): Deleted => ({ deleted: true }));
  api.post("/code/reviews", () => review("rv9", 9));
  api.post("/code/projects/p1/chat", () => projectBot);
  api.post("/code/threads/:id/suggest", ({ body }) => {
    const typed = (body as { typed?: string }).typed;
    return { suggestion: typed ? `${typed} the tests first` : "Get it merged to main" };
  });
  api.post("/code/threads", () => more.creating ?? { threadId: "new1" });
}

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
          <Route path="/code/p/:projectId" element={<OpenProjectChat />} />
          <Route path="/chats/:botId" element={<p>Bot chat page</p>} />
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
const project: ProjectView = {
  id: "p1",
  name: "web",
  repo: { owner: "acme", name: "web" },
  transport: "gh",
  baseBranch: "main",
  checkoutPath: "/code/acme--web/checkout",
  defaultInstanceId: "demo",
  defaultModel: null,
  chatBotId: null,
  settings: {
    scripts: {},
    archiveOnMerge: true,
    draftPulls: true,
    branchPrefix: "ta/",
    protectedPaths: [],
    workflowInstructions: "",
    instructions: "",
    autofix: {
      triggers: { checks: true, reviews: true, conflicts: true },
      trustedBots: [],
      hourlyLimit: 6,
      noOwnerLimit: 10,
      passMinutes: 20,
      onByDefault: false,
    },
  },
  createdAt: "2026-11-05T00:00:00Z",
};

const projectBot: Bot = {
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
};

const review = (
  id: string,
  number: number,
  over: Partial<PullReviewView> = {},
): PullReviewView => ({
  id,
  key: `acme/web#${number}`,
  projectId: "p1",
  repo: "acme/web",
  number,
  url: `https://github.com/acme/web/pull/${number}`,
  title: `PR ${number}`,
  author: "maria",
  headRef: "feature",
  baseRef: "main",
  headSha: "abc",
  fromFork: false,
  mine: false,
  reviewedSha: null,
  threadId: null,
  codingThreadId: null,
  worktreeThreadId: null,
  assistant: null,
  archived: false,
  updatedAt: "2026-11-17T09:00:00Z",
  brief: null,
  reviewing: false,
  findings: [],
  ...over,
});

const pull = (number: number, over: Partial<InboxPullView> = {}): InboxPullView => ({
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
  serve();
  asked.length = 0;
  openReviews.length = 0;
  inboxLimit.value = 10;
  useUiStore.setState({
    codeSidebarOpen: true,
    codePane: null,
    lastCodePane: "changes",
    draftsSending: [],
  });
  more.projects = [];
  more.creating = null;
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

  it("opens the project's chat on the bot chat page from the sidebar", async () => {
    renderAt("/code");
    fireEvent.click(await screen.findByRole("link", { name: "Project chat" }));
    expect(await screen.findByText("Bot chat page")).toBeInTheDocument();
    expect(where()).toBe("/chats/lead");
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
      expect(posts().map((post) => post.path)).toContain("/code/threads/demo%3Abb/interrupt"),
    );
  });

  it("Escape does not stop an idle agent", () => {
    renderAt("/code/t/demo%3Adddd");
    open(done);
    press("Escape");
    expect(posts().filter((post) => post.path.endsWith("/interrupt"))).toEqual([]);
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

  it("with no thread open, the page is the new thread box, as a new chat is", async () => {
    renderAt("/code");
    expect(
      await screen.findByRole("textbox", { name: "What should the agent do?" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("No thread open")).toBeNull();
  });

  it("keeps an unsent task while you look at another thread", async () => {
    renderAt("/code");
    const box = await screen.findByRole("textbox", { name: "What should the agent do?" });
    fireEvent.change(box, { target: { value: "Fix the login callback" } });
    fireEvent.click(document.querySelector('[data-thread="demo:a"]')!);
    await waitFor(() => expect(where()).toBe("/code/t/demo%3Aa"));
    press("n");
    expect(await screen.findByRole("textbox", { name: "What should the agent do?" })).toHaveValue(
      "Fix the login callback",
    );
  });

  it("keeps the project picked for an unsent task too", async () => {
    more.projects = [{ ...project, id: "p2", name: "api", repo: { owner: "acme", name: "api" } }];
    renderAt("/code");
    const box = await screen.findByRole("textbox", { name: "What should the agent do?" });
    await userEvent.click(await screen.findByRole("button", { name: "Project" }));
    await userEvent.click(await screen.findByRole("option", { name: /api/ }));
    fireEvent.change(box, { target: { value: "Fix the login callback" } });
    fireEvent.click(document.querySelector('[data-thread="demo:a"]')!);
    await waitFor(() => expect(where()).toBe("/code/t/demo%3Aa"));
    press("n");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Project" })).toHaveTextContent("api"),
    );
  });

  it("is just the box and its chips, with no heading, explainer or key hints", async () => {
    renderAt("/code");
    await screen.findByRole("textbox", { name: "What should the agent do?" });
    expect(screen.queryByRole("heading", { name: "New thread" })).toBeNull();
    expect(screen.queryByText(/own worktree/)).toBeNull();
    expect(screen.queryByText(/starts it/)).toBeNull();
  });

  it("keeps the project it picked for you when another project's thread updates", async () => {
    more.projects = [
      { ...project, id: "p2", name: "api", repo: { owner: "acme", name: "api" } },
      { ...project, id: "p3", name: "docs", repo: { owner: "acme", name: "docs" } },
    ];
    useCodeStore.setState({ threads: [thread("a", { projectId: "p3" })] });
    renderAt("/code");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Project" })).toHaveTextContent("docs"),
    );
    act(() => {
      useCodeStore.setState({
        threads: [
          thread("a", { projectId: "p3" }),
          thread("b", { projectId: "p2", updatedAt: "2026-11-06T00:00:00Z" }),
        ],
      });
    });
    expect(screen.getByRole("button", { name: "Project" })).toHaveTextContent("docs");
  });

  it("searches projects, with the ones you worked in lately under Recent and picked first", async () => {
    more.projects = [
      { ...project, id: "p2", name: "api", repo: { owner: "acme", name: "api" } },
      { ...project, id: "p3", name: "docs", repo: { owner: "acme", name: "docs" } },
    ];
    useCodeStore.setState({ threads: [thread("a", { projectId: "p3" })] });
    renderAt("/code");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Project" })).toHaveTextContent("docs"),
    );
    await userEvent.click(screen.getByRole("button", { name: "Project" }));
    const search = await screen.findByPlaceholderText("Choose a project…");
    expect(
      within(screen.getByRole("group", { name: "Recent" })).getByRole("option"),
    ).toHaveTextContent("docs");
    expect(
      within(screen.getByRole("group", { name: "Projects" }))
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["webacme/web", "apiacme/api"]);
    await userEvent.type(search, "api");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["apiacme/api"]);
  });

  it("keeps a task in the box while it starts, and leaving and coming back cannot send it twice", async () => {
    more.creating = new Promise(() => {});
    renderAt("/code");
    const box = await screen.findByRole("textbox", { name: "What should the agent do?" });
    await screen.findByText("web");
    fireEvent.change(box, { target: { value: "Fix the login callback" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() =>
      expect(posts().filter((post) => post.path === "/code/threads")).toHaveLength(1),
    );
    fireEvent.click(document.querySelector('[data-thread="demo:a"]')!);
    await waitFor(() => expect(where()).toBe("/code/t/demo%3Aa"));
    press("n");
    const again = await screen.findByRole("textbox", { name: "What should the agent do?" });
    expect(again).toHaveValue("Fix the login callback");
    expect(screen.getByRole("button", { name: "Start" })).toBeDisabled();
    fireEvent.keyDown(again, { key: "Enter" });
    expect(posts().filter((post) => post.path === "/code/threads")).toHaveLength(1);
  });

  it("keeps an unsent task on the project it was written for when another project becomes the latest", async () => {
    more.projects = [
      { ...project, id: "p2", name: "api", repo: { owner: "acme", name: "api" } },
      { ...project, id: "p3", name: "docs", repo: { owner: "acme", name: "docs" } },
    ];
    useCodeStore.setState({ threads: [thread("a", { projectId: "p3" })] });
    renderAt("/code");
    const box = await screen.findByRole("textbox", { name: "What should the agent do?" });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Project" })).toHaveTextContent("docs"),
    );
    fireEvent.change(box, { target: { value: "Fix the login callback" } });
    fireEvent.click(document.querySelector('[data-thread="demo:a"]')!);
    await waitFor(() => expect(where()).toBe("/code/t/demo%3Aa"));
    act(() => {
      useCodeStore.setState({
        threads: [
          thread("a", { projectId: "p3" }),
          thread("b", { projectId: "p2", updatedAt: "2026-11-06T00:00:00Z" }),
        ],
      });
    });
    press("n");
    const again = await screen.findByRole("textbox", { name: "What should the agent do?" });
    expect(again).toHaveValue("Fix the login callback");
    fireEvent.keyDown(again, { key: "Enter" });
    await waitFor(() =>
      expect(posts().find((post) => post.path === "/code/threads")?.body).toMatchObject({
        projectId: "p3",
        message: "Fix the login callback",
      }),
    );
  });

  it("n focuses the new thread box, not a dialog; Enter starts the thread in the remembered project", async () => {
    renderAt("/code");
    press("n");
    expect(where()).toBe("/code/new");
    const box = await screen.findByRole("textbox", { name: "What should the agent do?" });
    await waitFor(() => expect(box).toHaveFocus());
    expect(screen.queryByRole("dialog")).toBeNull();
    await screen.findByText("web");
    fireEvent.change(box, { target: { value: "Fix the login callback" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(where()).toBe("/code/t/new1"));
    expect(posts().find((post) => post.path === "/code/threads")?.body).toMatchObject({
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
      expect(posts()).toContainEqual({
        path: "/code/threads/demo%3Accc/archive",
        body: { archived: true },
      }),
    );

    fireEvent.contextMenu(document.querySelector('[data-thread="demo:a"]')!);
    const second = await screen.findByRole("menu");
    expect(within(second).queryByRole("menuitem", { name: /Open PR/ })).toBeNull();
    fireEvent.click(within(second).getByRole("menuitem", { name: "Delete" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deletes()).toEqual(["/code/threads/demo%3Aa"]));
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
    const suggested = posts().find((post) => post.path.endsWith("/suggest"));
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
    expect(posts().filter((post) => post.path.endsWith("/suggest"))).toHaveLength(2);
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
      review("rv1", 1),
      review("rv8", 8, {
        repo: "acme/api",
        author: "li",
        url: "https://github.com/acme/api/pull/8",
      }),
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
    expect(posts()).toEqual([
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
    expect(posts()).toEqual([{ path: "/code/reviews", body: { pr: "acme/web#7" } }]);
  });
});
