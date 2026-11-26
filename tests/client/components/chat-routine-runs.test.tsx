/**
 * @vitest-environment jsdom
 *
 * Routine results in the bot's chat (issue #63) stay quiet: back-to-back runs
 * show as one line between the messages around them, and clicking it shows
 * each run's output and error. The bot stream is a fake (fakes/sse.ts), so
 * no server is involved.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { BrowserRouter } from "react-router-dom";
import { ChatPane } from "@/components/ChatPane";
import { useBotsStore } from "@/store/bots";
import { chatSessions } from "@/store/chats";
import type { Bot } from "../../../apps/web/src/shared/api/bots";
import type { CatalogModel } from "../../../apps/web/src/shared/api/models";
import type { RoutineRunCard } from "@/lib/chat-types";
import { botStream } from "../fakes/sse";

vi.mock("@/lib/bots-api", () => ({
  botsApi: {
    send: vi.fn(),
    abort: vi.fn(),
    reset: vi.fn(),
    read: vi.fn().mockResolvedValue(undefined),
    capabilities: vi.fn().mockResolvedValue([]),
    pastChats: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("@/lib/sse", async () => (await import("../fakes/sse")).sseModule);

const model: CatalogModel = {
  id: "test-model",
  name: "Test Model",
  providerId: "faux",
  providerName: "Faux",
  providerKind: "faux",
  upstreamId: "test-model",
  type: "chat",
  engine: "pi",
  maxOutputTokens: 16_384,
  enabled: true,
  available: true,
  reasoning: false,
  contextWindow: 128000,
  vision: false,
};

const BOT = {
  id: "host",
  conversationId: "c1",
  name: "Host Bot",
  description: "",
  systemPrompt: "",
  modelId: "test-model",
  lastReadAt: null,
  lastActivityAt: new Date().toISOString(),
  lastMessagePreview: null,
  toolPermissions: {},
  skillIds: [],
  connectionIds: [],
  memoryEnabled: true,
  autoReview: false,
  yoloByDefault: false,
  browserProfile: "shared",
  projectId: null,
  pinnedAt: null,
  guestIds: [],
  chatStartedAt: new Date().toISOString(),
  memoryCapturedThrough: null,
  connectionCapabilities: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
} as Bot;

const at = (minute: number) => Date.parse(`2026-10-20T03:${minute}:00.000Z`);

const run = (id: string, minute: number, extra: Partial<RoutineRunCard> = {}): RoutineRunCard => ({
  id,
  routineId: "r1",
  routineName: "Process emails",
  status: "succeeded",
  trigger: "schedule",
  scheduledFor: new Date(at(minute)).toISOString(),
  finishedAt: new Date(at(minute)).toISOString(),
  output: `Output ${id}`,
  error: null,
  ...extra,
});

afterEach(cleanup);

function renderWith(runs: RoutineRunCard[]) {
  useBotsStore.setState({
    bots: [{ ...BOT, unread: false, replying: false, approvals: 0, questions: 0 }],
    canAnswer: true,
  });
  chatSessions.store.setState({ sessions: {} });
  render(
    <BrowserRouter>
      <ChatPane bot={BOT} models={[model]} canAnswer onEditBot={() => {}} />
    </BrowserRouter>,
  );
  botStream("host").send(
    {
      type: "snapshot",
      state: {
        messages: [
          { id: "u1", role: "user", text: "before the runs", status: "done", createdAt: at(10) },
          { id: "u2", role: "user", text: "after the runs", status: "done", createdAt: at(50) },
        ],
        busy: false,
        queued: [],
      },
    },
    { type: "routine-runs", runs },
  );
}

describe("ChatPane — routine runs", () => {
  it("folds back-to-back runs into one quiet line between the messages", async () => {
    renderWith([
      run("a", 20),
      run("b", 25, {
        status: "failed",
        output: "**Drafted** the email.",
        error:
          "Needs approval for `send_email`; set it to Allow for this bot to use it in routines.",
      }),
      run("c", 30),
    ]);

    const lines = await screen.findAllByTestId("routine-runs");
    expect(lines).toHaveLength(1);
    const line = lines[0];
    const toggle = within(line).getByRole("button");
    expect(toggle).toHaveTextContent(/^Process emails·ran 3×1 failed·last 09:00$/);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(within(line).queryByText("Output a")).toBeNull();

    const before = screen.getByText("before the runs");
    const after = screen.getByText("after the runs");
    expect(before.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(line.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await userEvent.setup().click(toggle);
    const details = within(line).getAllByTestId("routine-run");
    expect(details.map((detail) => detail.dataset.status)).toEqual([
      "succeeded",
      "failed",
      "succeeded",
    ]);
    expect(within(details[1]).getByText("Drafted the email.")).toBeInTheDocument();
    expect(within(details[1]).getByText(/Needs approval for `send_email`/)).toBeInTheDocument();
    expect(within(line).getByRole("link", { name: "Open routines" })).toHaveAttribute(
      "href",
      "/routines",
    );
  });

  it("shows a single run as its name, status and time", async () => {
    renderWith([run("only", 20)]);
    const line = await screen.findByTestId("routine-runs");
    expect(within(line).getByRole("button")).toHaveTextContent(/^Process emails·done·08:50$/);
  });
});
