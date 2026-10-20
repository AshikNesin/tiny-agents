/**
 * @vitest-environment jsdom
 *
 * Composer wiring for @mentions (issue #12), at the ChatPane level: the
 * overlay opens on `@`, keys travel from the focused textarea into it,
 * insertion rewrites the token, and the send carries the resolved bot ids.
 * The SSE store is mocked so no server is involved.
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { BrowserRouter } from "react-router-dom";
import { ChatPane } from "@/components/ChatPane";
import { useBotsStore } from "@/store/bots";
import type { Bot, ModelInfo } from "@/lib/bots-api";

const sendMock = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/bots-api", () => ({
  botsApi: {
    send: (...args: unknown[]) => sendMock(...args),
    abort: vi.fn(),
    reset: vi.fn(),
    read: vi.fn(),
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
};

const HOST: Bot = {
  id: "host",
  conversationId: "c1",
  name: "Host Bot",
  description: "",
  systemPrompt: "",
  modelId: "test-model",
  lastReadAt: null,
  lastActivityAt: new Date().toISOString(),
  lastMessagePreview: null,
  toolkits: [],
  toolPermissions: {},
  skillIds: [],
  connectionIds: [],
  memoryEnabled: true,
  pinnedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

function seedStore(bots: Array<{ id: string; name: string; description: string }>) {
  useBotsStore.setState({
    bots: bots.map((bot) => ({ ...bot, conversationId: "c", unread: false, replying: false })),
    gatewayConfigured: true,
    chats: {},
  });
}

function renderPane() {
  render(
    <BrowserRouter>
      <ChatPane
        bot={HOST}
        models={[model]}
        gatewayConfigured
        onEditBot={() => {}}
        onBotDeleted={() => {}}
        onBotReset={() => {}}
      />
    </BrowserRouter>,
  );
  return screen.getByRole("textbox") as HTMLTextAreaElement;
}

const user = userEvent.setup();

beforeEach(() => {
  sendMock.mockClear();
});

describe("ChatPane mention wiring", () => {
  it("opens the overlay on @, inserts on Enter, and keeps typing", async () => {
    seedStore([
      { id: "b1", name: "Ada", description: "Loves proofs" },
      { id: "b2", name: "Grace", description: "" },
    ]);
    const composer = renderPane();

    await user.type(composer, "hey @ad");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(1);

    await user.type(composer, "{Enter}");
    expect(composer.value).toBe("hey @Ada ");

    // The overlay closed; Enter now sends.
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("does not open for a mid-word @ (email)", async () => {
    seedStore([{ id: "b1", name: "Ada", description: "" }]);
    const composer = renderPane();
    await user.type(composer, "mail a@ad");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("excludes the host bot from the roster", async () => {
    seedStore([
      { id: "host", name: "Host Bot", description: "" },
      { id: "b1", name: "Ada", description: "" },
    ]);
    const composer = renderPane();
    await user.type(composer, "@");
    const rows = screen.getAllByRole("option");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("Ada");
  });

  it("sends the mentioned bot ids and not the host", async () => {
    seedStore([
      { id: "host", name: "Host Bot", description: "" },
      { id: "b1", name: "Ada", description: "" },
      { id: "b2", name: "Grace", description: "" },
    ]);
    const composer = renderPane();
    await user.type(composer, "@Ada ask @Grace too");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    await user.type(composer, "{Enter}");

    await waitFor(() => expect(sendMock).toHaveBeenCalled());
    expect(sendMock.mock.calls[0]![0]).toBe("host");
    expect(sendMock.mock.calls[0]![2]).toBe("@Ada ask @Grace too");
    expect(sendMock.mock.calls[0]![3]).toEqual(["b1", "b2"]);
  });
});
