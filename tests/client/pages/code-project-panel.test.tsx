import React from "react";
import { fireEvent, render as renderBare, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { ConfirmProvider } from "@groot/ui/primitives";
import { NO_CAPABILITIES } from "@tiny-agents/code/contracts";
import { ProjectChat } from "@/pages/code/ProjectChat";
import { useCodeStore } from "@/store/code";
import { useUiStore } from "@/store/ui";
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
          : path === "/bots/lead/memories"
            ? { memories: [] }
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
  const { pathname, search } = useLocation();
  return <output data-testid="where">{pathname + search}</output>;
}

function ProjectChatAt() {
  return <ProjectChat projectId="p1" onOpenMenu={() => undefined} />;
}

const renderAt = (path: string) =>
  render(
    <ConfirmProvider>
      <MemoryRouter initialEntries={[path]}>
        <Where />
        <Routes>
          <Route path="/chats/:botId" element={<ProjectChatAt />} />
          <Route path="/code/reviews/:id" element={<p>Review page</p>} />
        </Routes>
      </MemoryRouter>
    </ConfirmProvider>,
  );

const where = () => screen.getByTestId("where").textContent;
const showPanel = async () => {
  await screen.findByPlaceholderText("Message web");
  fireEvent.click(screen.getByRole("button", { name: /^Threads/ }));
};
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
  settings: { instructions: "Merge finished work to main once CI is green." },
  chatBotId: "lead",
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

const elsewhere = thread("other", {
  projectId: "p2",
  status: { group: "needs-you", reason: null },
});
const phone = (matches: boolean) =>
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: matches && query === "(max-width: 1023px)",
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
const panel = () => screen.getByRole("complementary", { name: "Project panel" });

beforeEach(() => {
  posts.length = 0;
  deletes.length = 0;
  asked.length = 0;
  openReviews.length = 0;
  inboxLimit.value = 10;
  phone(false);
  useUiStore.setState({ codeSidebarOpen: true, codePane: null, lastCodePane: "changes" });
  useCodeStore.setState({
    harnesses: [agent],
    statuses: {},
    threads: [done, reviewed, running, waiting, elsewhere],
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("the project chat's side panel", () => {
  it("lists the project's threads beside the chat, grouped by state", async () => {
    renderAt("/chats/lead");
    await showPanel();
    const sections = [...panel().querySelectorAll("section[aria-label]")].map((section) => [
      section.getAttribute("aria-label"),
      [...section.querySelectorAll("[data-thread]")].map((row) => row.getAttribute("data-thread")),
    ]);
    expect(sections).toEqual([
      ["Needs you", ["demo:a"]],
      ["Working", ["demo:bb"]],
      ["In review", ["demo:ccc"]],
      ["Done", []],
      ["Archived", []],
    ]);
    expect(within(panel()).getByRole("button", { name: /Done · 1/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("gives each thread a one-line status and its pull request", async () => {
    useCodeStore.setState({
      threads: [
        thread("a", { status: { group: "needs-you", reason: "asks you" } }),
        thread("bb", {
          preview: "PR 529 merged to main",
          pr: { number: 529, loop: "merged", url: "https://x/529" },
          status: { group: "needs-you", reason: "finished" },
        }),
      ],
    });
    renderAt("/chats/lead");
    await showPanel();
    expect(panel().querySelector('[data-thread="demo:a"]')).toHaveTextContent("asks you");
    const merged = panel().querySelector('[data-thread="demo:bb"]');
    expect(merged).toHaveTextContent("PR 529 merged to main");
    expect(merged).toHaveTextContent("#529");
  });

  it("says a paused pull request is paused, not open", async () => {
    const paused = thread("ccc", {
      pr: { number: 12, loop: "paused", url: "https://x/12" },
      status: { group: "review", reason: null },
    });
    useCodeStore.setState({ threads: [paused] });
    renderAt("/chats/lead");
    await showPanel();
    fireEvent.click(panel().querySelector('[data-thread="demo:ccc"]')!);
    open(paused);
    const bar = await within(panel()).findByTestId("project-panel-pr");
    expect(bar).toHaveTextContent("Paused");
    expect(within(bar).getByLabelText("Pull request #12, Paused")).toBeInTheDocument();
  });

  it("search narrows the list by title", async () => {
    renderAt("/chats/lead");
    await showPanel();
    fireEvent.change(within(panel()).getByRole("searchbox", { name: "Search threads" }), {
      target: { value: "thread bb" },
    });
    expect(
      [...panel().querySelectorAll("[data-thread]")].map((r) => r.getAttribute("data-thread")),
    ).toEqual(["demo:bb"]);
  });

  it("a thread opens inside the panel with its transcript, PR bar and steer box, and back returns", async () => {
    renderAt("/chats/lead");
    await showPanel();
    fireEvent.click(panel().querySelector('[data-thread="demo:ccc"]')!);
    expect(where()).toBe("/chats/lead?thread=demo%3Accc");
    open(reviewed);
    expect(within(panel()).getByText("Fix the login callback")).toBeInTheDocument();
    expect(within(panel()).getByTestId("project-panel-pr")).toHaveTextContent("#12");
    const steer = within(panel()).getByRole("textbox", { name: "Message Demo agent" });
    fireEvent.change(steer, { target: { value: "Rebase on main" } });
    fireEvent.keyDown(steer, { key: "Enter" });
    await waitFor(() =>
      expect(posts.find((p) => p.path === "/code/threads/demo%3Accc/messages")?.body).toMatchObject(
        { message: "Rebase on main" },
      ),
    );
    expect(screen.getByPlaceholderText("Message web")).toBeInTheDocument();
    fireEvent.click(within(panel()).getByRole("button", { name: "Back to threads" }));
    expect(where()).toBe("/chats/lead");
    expect(panel().querySelector('[data-thread="demo:a"]')).toBeInTheDocument();
  });

  it("the Context tab shows the project's repository and instructions", async () => {
    renderAt("/chats/lead");
    await showPanel();
    fireEvent.click(within(panel()).getByRole("tab", { name: "Context" }));
    expect(
      await within(panel()).findByText("Merge finished work to main once CI is green."),
    ).toBeInTheDocument();
    expect(within(panel()).getByRole("link", { name: "acme/web" })).toHaveAttribute(
      "href",
      "https://github.com/acme/web",
    );
  });

  it("starts closed like a bot chat, and the Threads button shows and hides the panel", async () => {
    renderAt("/chats/lead");
    await screen.findByPlaceholderText("Message web");
    const toggle = screen.getByRole("button", { name: /^Threads/ });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("complementary", { name: "Project panel" })).toBeNull();
    fireEvent.click(toggle);
    expect(panel()).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.queryByRole("complementary", { name: "Project panel" })).toBeNull();
  });

  it("on a phone the chat comes first and the panel opens over it, full screen", async () => {
    phone(true);
    renderAt("/chats/lead");
    const chat = await screen.findByPlaceholderText("Message web");
    expect(screen.queryByRole("complementary", { name: "Project panel" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Threads/ }));
    expect(panel()).toBeInTheDocument();
    expect(chat).not.toBeVisible();
    fireEvent.click(within(panel()).getByRole("button", { name: "Close the panel" }));
    expect(chat).toBeVisible();
  });

  it("on a phone a thread link opens the panel on that thread", async () => {
    phone(true);
    renderAt("/chats/lead?thread=demo%3Aa");
    await screen.findByPlaceholderText("Message web");
    open(waiting);
    expect(within(panel()).getByText("Fix the login callback")).toBeInTheDocument();
  });
});
