/**
 * @vitest-environment jsdom
 *
 * Routine results in the bot's chat (issue #63): a finished run shows as a
 * card between the messages around it, with its status, output and error.
 * The SSE store is mocked so no server is involved.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { BrowserRouter } from "react-router-dom";
import { ChatPane } from "@/components/ChatPane";
import { useBotsStore } from "@/store/bots";
import type { Bot, ModelInfo } from "@/lib/bots-api";

vi.mock("@/lib/bots-api", () => ({
  botsApi: {
    send: vi.fn(),
    abort: vi.fn(),
    reset: vi.fn(),
    read: vi.fn().mockResolvedValue(undefined),
    capabilities: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("@/lib/sse", () => ({
  subscribeSse: vi.fn(() => ({ close: () => undefined })),
}));

const model: ModelInfo = {
  id: "test-model",
  name: "Test Model",
  family: "other",
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
  browserProfile: "shared",
  pinnedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
} as Bot;

afterEach(cleanup);

describe("ChatPane — routine run cards", () => {
  it("renders finished runs between the messages around them", async () => {
    useBotsStore.setState({
      bots: [{ ...BOT, unread: false, replying: false, approvals: 0, questions: 0 }],
      gatewayConfigured: true,
      chats: {},
    });
    useBotsStore.getState().connectChat("host");
    const at = (minute: number) => Date.parse(`2026-10-20T03:${minute}:00.000Z`);
    useBotsStore.getState().applyChatEvent("host", {
      type: "snapshot",
      state: {
        messages: [
          { id: "u1", role: "user", text: "before the run", status: "done", createdAt: at(10) },
          { id: "u2", role: "user", text: "after the run", status: "done", createdAt: at(40) },
        ],
        busy: false,
        queued: [],
      } as never,
    });
    useBotsStore.getState().applyChatEvent("host", {
      type: "routine-runs",
      runs: [
        {
          id: "run-1",
          routineId: "r1",
          routineName: "Morning digest",
          status: "failed",
          trigger: "schedule",
          scheduledFor: new Date(at(30)).toISOString(),
          finishedAt: new Date(at(31)).toISOString(),
          output: "**Drafted** the email.",
          error:
            "Needs approval for `send_email`; set it to Allow for this bot to use it in routines.",
        },
      ],
    });

    render(
      <BrowserRouter>
        <ChatPane
          bot={BOT}
          models={[model]}
          gatewayConfigured
          onEditBot={() => {}}
          onBotReset={() => {}}
        />
      </BrowserRouter>,
    );

    const card = await screen.findByTestId("routine-run-card");
    expect(card.dataset.status).toBe("failed");
    expect(within(card).getByRole("link", { name: "Morning digest" })).toHaveAttribute(
      "href",
      "/routines",
    );
    // Markdown flattened, error shown.
    expect(within(card).getByText("Drafted the email.")).toBeInTheDocument();
    expect(within(card).getByText(/Needs approval for `send_email`/)).toBeInTheDocument();

    const before = screen.getByText("before the run");
    const after = screen.getByText("after the run");
    expect(before.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(card.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
