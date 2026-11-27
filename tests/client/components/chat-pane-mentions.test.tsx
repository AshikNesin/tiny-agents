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
import type { Bot, SendMessageBody } from "../../../apps/web/src/shared/api/bots";
import type { CatalogModel } from "../../../apps/web/src/shared/api/models";
import { AppQueryProvider } from "../query-provider";
import { chatBackend } from "./chat-backend";

vi.mock("@/lib/sse", async () => (await import("../fakes/sse")).sseModule);

let api: ReturnType<typeof chatBackend>;
const sends = () => api.sent<SendMessageBody>("POST", "/bots/host/messages");

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
};

function seedStore(bots: Array<{ id: string; name: string; description: string }>) {
  useBotsStore.setState({
    bots: bots.map((bot) => ({
      ...bot,
      conversationId: "c",
      modelId: "test-model",
      lastMessagePreview: null,
      lastActivityAt: HOST.lastActivityAt,
      lastReadAt: null,
      unread: false,
      replying: false,
      approvals: 0,
      questions: 0,
      pinnedAt: null,
      projectId: null,
    })),
    canAnswer: true,
  });
}

function renderPane() {
  render(
    <AppQueryProvider>
      <BrowserRouter>
        <ChatPane bot={HOST} models={[model]} canAnswer onEditBot={() => {}} />
      </BrowserRouter>
    </AppQueryProvider>,
  );
  return screen.getByRole("textbox") as HTMLTextAreaElement;
}

const user = userEvent.setup();

beforeEach(() => {
  api = chatBackend(HOST);
  localStorage.clear();
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

    await waitFor(() => expect(sends()).toHaveLength(1));
    expect(sends()[0]!.body.text).toBe("@Ada ask @Grace too");
    expect(sends()[0]!.body.mentions).toEqual(["b1", "b2"]);
  });

  const twins = [
    { id: "e1", name: "Echo", description: "" },
    { id: "e2", name: "Echo", description: "Echoes back" },
  ];

  it("sends to the bot picked from the list, not the first with that name", async () => {
    seedStore(twins);
    const composer = renderPane();
    await user.type(composer, "@Ech");
    await user.click(screen.getByRole("option", { name: /Echoes back/ }));
    await user.type(composer, "ping{Enter}");

    await waitFor(() => expect(sends()).toHaveLength(1));
    expect(sends()[0]!.body.text).toBe("@Echo ping");
    expect(sends()[0]!.body.mentions).toEqual(["e2"]);
  });

  it("holds a typed name several bots share and asks to pick one", async () => {
    seedStore(twins);
    const composer = renderPane();
    await user.type(composer, "@Echo{Escape} ping{Enter}");

    expect(screen.getByRole("alert")).toHaveTextContent(
      'More than one bot is named "Echo". Type @ and pick the one you mean from the list.',
    );
    expect(sends()).toHaveLength(0);
    expect(composer.value).toBe("@Echo ping");
  });
});
