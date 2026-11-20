/**
 * @vitest-environment jsdom
 *
 * `ChatMessageView` pinned message kind by message kind: the element tree
 * with roles, names, test ids and text, and the whole markup, for the
 * divider, a person's bubble (mine, someone else's, failed, with
 * attachments), each peer card, and an assistant turn in each status with
 * each tool card and trace row, live and read-only. Recorded on the one-file
 * component before it was split (docs/rewrite/PLAN.md row 5.6), so the split
 * must render each the same. Markdown is a stand-in.
 */
import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { MemoryRouter } from "react-router-dom";
import { useAuthStore } from "@groot/shell/store/auth";
import { ChatMessageView, PeerIncomingCard } from "@/components/ChatMessageView";
import type { ChatMessage, ChatToolCall } from "@/lib/chat-types";
import { OwnerActionsProvider, type OwnerActions } from "@/lib/owner-actions";
import { markup, outline } from "../dom-outline";
import { AppQueryProvider } from "../query-provider";

vi.mock("@/lib/vault-api", () => ({
  apiError: (_error: unknown, fallback: string) => fallback,
  vaultApi: { request: () => new Promise(() => {}) },
}));

vi.mock("streamdown", () => ({
  Streamdown: ({ children }: { children?: React.ReactNode }) => (
    <div data-stand-in="streamdown">{children}</div>
  ),
}));

const actions: OwnerActions = {
  decideApproval: vi.fn(),
  answerQuestions: vi.fn(),
  handBackComputer: vi.fn(),
};

const toolLabels = {
  browser_navigate: "Opened a page",
  web_search: "Searched the web",
  read_page: "Read a page",
  load_skill: "Loaded a skill",
};
const toolAskLabels = { browser_navigate: "open a page", run_command: "run a command" };

const NOW = Date.now();
const MINUTE = 60_000;

const message = (overrides: Partial<ChatMessage>): ChatMessage => ({
  id: "m1",
  role: "assistant",
  text: "",
  status: "done",
  createdAt: NOW - 30 * MINUTE,
  ...overrides,
});

const call = (overrides: Partial<ChatToolCall>): ChatToolCall => ({
  id: "c1",
  name: "browser_navigate",
  args: {},
  status: "done",
  ...overrides,
});

const withCalls = (toolCalls: ChatToolCall[], overrides: Partial<ChatMessage> = {}) =>
  message({ toolCalls, ...overrides });

function mount(msg: ChatMessage, owner: OwnerActions | null = actions) {
  const view = (
    <ChatMessageView
      message={msg}
      botName="Chief"
      toolLabels={toolLabels}
      toolAskLabels={toolAskLabels}
    />
  );
  return render(
    <AppQueryProvider>
      <MemoryRouter>
        {owner ? <OwnerActionsProvider actions={owner}>{view}</OwnerActionsProvider> : view}
      </MemoryRouter>
    </AppQueryProvider>,
  );
}

function pin(container: Element) {
  expect(outline(container)).toMatchSnapshot("outline");
  expect(markup(container)).toMatchSnapshot("markup");
}

beforeEach(() => {
  useAuthStore.setState({ user: { id: 1 } } as never);
});

const VAULT = {
  handle: "vault:acme",
  label: "Acme login",
  kind: "login" as const,
  tool: "browser_fill",
  target: "https://acme.test",
  username: "ada",
  grantable: true,
};

const CASES: [string, ChatMessage][] = [
  ["marker", message({ role: "marker", marker: "compaction" })],
  ["user: mine, today", message({ role: "user", text: "Hello there", createdAt: NOW - MINUTE })],
  ["user: mine, fresh", message({ role: "user", text: "Just now", createdAt: NOW - 1000 })],
  [
    "user: mine, this week",
    message({ role: "user", text: "Earlier", createdAt: NOW - 3 * 24 * 60 * MINUTE }),
  ],
  [
    "user: mine, long ago",
    message({ role: "user", text: "Long ago", createdAt: NOW - 40 * 24 * 60 * MINUTE }),
  ],
  ["user: no time", message({ role: "user", text: "No time", createdAt: 0 })],
  [
    "user: someone else's",
    message({ role: "user", text: "From a guest", author: { id: 2, name: "grace" } }),
  ],
  ["user: my own authored", message({ role: "user", text: "Mine", author: { id: 1, name: "me" } })],
  [
    "user: unanswered",
    message({ role: "user", text: "Lost", status: "unanswered", error: "Not delivered." }),
  ],
  [
    "user: someone else's, unanswered",
    message({
      role: "user",
      text: "Lost too",
      status: "unanswered",
      error: "Not delivered.",
      author: { id: 2, name: "grace" },
    }),
  ],
  [
    "user: attachments only",
    message({
      role: "user",
      text: "",
      attachments: [
        { uploadId: "u1", kind: "image", name: "a.png", mimeType: "image/png", size: 10 },
        {
          uploadId: "u2",
          kind: "file",
          name: "notes.pdf",
          mimeType: "application/pdf",
          size: 2048,
          status: "ready",
        },
      ],
    }),
  ],
  [
    "user: text and attachment",
    message({
      role: "user",
      text: "See attached",
      attachments: [
        {
          uploadId: "u2",
          kind: "file",
          name: "notes.pdf",
          mimeType: "application/pdf",
          size: 2048,
          status: "ready",
        },
      ],
    }),
  ],
  [
    "peer: mention",
    message({
      role: "user",
      text: "what do you think?",
      peer: { kind: "mention", hostName: "Ada" },
    }),
  ],
  [
    "peer: mention, unanswered",
    message({
      role: "user",
      text: "hello?",
      peer: { kind: "mention", hostName: "Ada" },
      status: "unanswered",
      error: "No reply.",
    }),
  ],
  [
    "peer: message",
    message({
      role: "user",
      text: "**Message from Radar:** check this",
      peer: { kind: "message", name: "Radar" },
    }),
  ],
  [
    "peer: message, streaming",
    message({
      role: "user",
      text: "on it",
      peer: { kind: "message", name: "Radar" },
      status: "streaming",
    }),
  ],
  [
    "peer: reply, unanswered without error",
    message({
      role: "user",
      text: "**Reply from Radar:** the plan",
      peer: { kind: "reply", name: "Radar" },
      status: "unanswered",
    }),
  ],
  ["assistant: text", message({ text: "Here is the answer." })],
  ["assistant: fresh text", message({ text: "Fresh", createdAt: NOW - 1000 })],
  ["assistant: streaming, nothing yet", message({ status: "streaming", createdAt: NOW })],
  ["assistant: streaming text", message({ status: "streaming", text: "Partial", createdAt: NOW })],
  [
    "assistant: reasoning while streaming",
    message({ status: "streaming", reasoning: "Let me think", createdAt: NOW }),
  ],
  ["assistant: reasoning done", message({ reasoning: "I thought", text: "Answer" })],
  ["assistant: error, no text", message({ status: "error" })],
  ["assistant: error with detail", message({ status: "error", error: "Rate limited", text: "Hm" })],
  ["assistant: stopped", message({ status: "stopped", text: "Half" })],
  ["assistant: unanswered", message({ status: "unanswered", error: "Never answered." })],
  ["assistant: tool only", withCalls([call({})])],
  [
    "assistant: running tool while streaming",
    withCalls([call({ status: "running" })], { status: "streaming", createdAt: NOW }),
  ],
  [
    "assistant: pending tool while streaming",
    withCalls([call({ status: "pending" })], { status: "streaming", createdAt: NOW }),
  ],
  [
    "assistant: done tool while streaming",
    withCalls([call({ status: "done" })], { status: "streaming", createdAt: NOW }),
  ],
  [
    "tool: with output, sources, duration",
    withCalls([
      call({
        name: "web_search",
        args: { query: "tiny agents" },
        output: '{"hits":2}',
        durationMs: 2300,
        sources: [
          { url: "https://a.test/", title: "A" },
          { url: "https://b.test/", title: "B" },
        ],
      }),
    ]),
  ],
  ["tool: load_skill", withCalls([call({ name: "load_skill", args: { name: "deploy" } })])],
  ["tool: error", withCalls([call({ status: "error", output: "boom" })])],
  ["tool: denied", withCalls([call({ status: "denied", approval: "denied" })])],
  ["tool: expired", withCalls([call({ status: "expired" })])],
  ["tool: auto-approved", withCalls([call({ approval: "auto", durationMs: 120 })])],
  [
    "tool: group of finished",
    withCalls([
      call({ id: "a", name: "read_page", durationMs: 1000 }),
      call({ id: "b", name: "read_page", durationMs: 1500 }),
      call({ id: "c", name: "web_search", status: "error", output: "x" }),
      call({ id: "d", name: "browser_navigate", status: "running" }),
    ]),
  ],
  [
    "card: approval",
    withCalls([
      call({ status: "awaiting_approval", taskId: 7, args: { url: "https://example.com" } }),
    ]),
  ],
  [
    "card: approval, folded payload",
    withCalls([
      call({
        name: "update_instructions",
        status: "awaiting_approval",
        taskId: 7,
        args: { instructions: "Do the thing.\n".repeat(40) },
      }),
    ]),
  ],
  [
    "card: approval, create_bot facts",
    withCalls([
      call({
        name: "create_bot",
        status: "awaiting_approval",
        taskId: 8,
        args: { name: "Scout", description: "Finds things", systemPrompt: "Be brief." },
      }),
    ]),
  ],
  [
    "card: vault approval, grantable",
    withCalls([call({ status: "awaiting_approval", taskId: 9, vault: VAULT })]),
  ],
  [
    "card: vault approval, run_command",
    withCalls([
      call({
        name: "run_command",
        status: "awaiting_approval",
        taskId: 9,
        args: { command: "curl https://acme.test" },
        vault: {
          ...VAULT,
          kind: "api_key",
          tool: "run_command",
          grantable: false,
          env: ["ACME_KEY"],
          hosts: ["acme.test"],
        },
      }),
    ]),
  ],
  [
    "card: credentials",
    withCalls([
      call({
        name: "request_credentials",
        status: "awaiting_credentials",
        taskId: 10,
        credentials: {
          status: "pending",
          origin: "https://acme.test",
          title: "Acme",
          purpose: "Sign in to Acme",
          fields: [{ key: "password", label: "Password", type: "password", required: true }],
        },
      }),
    ]),
  ],
  [
    "card: takeover",
    withCalls([
      call({
        name: "computer_request_takeover",
        status: "awaiting_takeover",
        taskId: 11,
        takeover: { status: "pending", reason: "Solve the captcha." },
      }),
    ]),
  ],
  [
    "card: question",
    withCalls([
      call({
        name: "ask_owner",
        status: "awaiting_answer",
        taskId: 12,
        questions: [{ question: "Which one?", options: [{ label: "A" }, { label: "B" }] }],
      }),
    ]),
  ],
  [
    "card: asked questions",
    withCalls([
      call({
        name: "ask_owner",
        status: "done",
        taskId: 12,
        questions: [{ question: "Which one?", options: [{ label: "A" }, { label: "B" }] }],
        answers: [{ selected: ["A"] }],
      }),
    ]),
  ],
  [
    "card: bot hand-off",
    withCalls([call({ name: "message_bot", args: { bot: "Radar", message: "Look into it" } })]),
  ],
  [
    "card: code hand-off",
    withCalls([
      call({
        name: "code_start",
        args: { prompt: "Fix it" },
        code: {
          threadId: "t1",
          harness: "shelley",
          title: "Fix the bug",
          cwd: "/repo",
          url: "/code/t1",
        },
      }),
    ]),
  ],
];

describe("ChatMessageView, pinned", () => {
  it.each(CASES)("%s", (_name, msg) => {
    const { container } = mount(msg);
    pin(container);
  });

  it.each(CASES.filter(([name]) => name.startsWith("card:")))(
    "read-only (no owner actions) %s",
    (_name, msg) => {
      const { container } = mount(msg, null);
      pin(container);
    },
  );

  it("takeover without hand-back", () => {
    const { container } = mount(CASES.find(([name]) => name === "card: takeover")![1], {
      decideApproval: vi.fn(),
      answerQuestions: vi.fn(),
    });
    pin(container);
  });

  it("PeerIncomingCard on its own", () => {
    const { container } = render(<PeerIncomingCard name="Radar" text="hi" />);
    pin(container);
  });

  it("a tool row opens to its input, output and sources", async () => {
    const user = userEvent.setup();
    const { container } = mount(
      CASES.find(([n]) => n === "tool: with output, sources, duration")![1],
    );
    await user.click(screen.getByRole("button", { name: /Searched the web/ }));
    await waitFor(() =>
      expect(container.querySelectorAll("[style*='--shiki-light']").length).toBeGreaterThan(0),
    );
    pin(container);
  });

  it("a failed tool row opens to a destructive output", async () => {
    const user = userEvent.setup();
    const { container } = mount(CASES.find(([n]) => n === "tool: error")![1]);
    await user.click(screen.getByRole("button", { name: /Opened a page/ }));
    await waitFor(() =>
      expect(container.querySelectorAll("[style*='--shiki-light']").length).toBeGreaterThan(0),
    );
    pin(container);
  });

  it("a group opens to its calls", async () => {
    const user = userEvent.setup();
    const { container } = mount(CASES.find(([n]) => n === "tool: group of finished")![1]);
    const group = container.querySelector("[data-testid='tool-group'] button")!;
    await user.click(group);
    pin(container);
  });

  it("an approval's Read more shows the payload", async () => {
    const user = userEvent.setup();
    const { container } = mount(CASES.find(([n]) => n === "card: approval, folded payload")![1]);
    await user.click(screen.getByRole("button", { name: "Read more" }));
    pin(container);
  });

  it("reasoning folds when the turn finishes and opens on click", async () => {
    const user = userEvent.setup();
    const running = message({ status: "streaming", reasoning: "Let me think", createdAt: NOW });
    const { container, rerender } = mount(running);
    rerender(
      <AppQueryProvider>
        <MemoryRouter>
          <OwnerActionsProvider actions={actions}>
            <ChatMessageView
              message={{ ...running, status: "done", text: "Done" }}
              botName="Chief"
              toolLabels={toolLabels}
              toolAskLabels={toolAskLabels}
            />
          </OwnerActionsProvider>
        </MemoryRouter>
      </AppQueryProvider>,
    );
    pin(container);
    await user.click(screen.getByRole("button", { name: /Reasoning/ }));
    pin(container);
  });

  it("copy swaps its icon", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const { container } = mount(message({ text: "Copy me" }));
    await act(async () => {
      screen.getByRole("button", { name: "Copy message" }).click();
    });
    expect(writeText).toHaveBeenCalledWith("Copy me");
    pin(container);
  });
});
