/**
 * @vitest-environment jsdom
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { BrowserRouter } from "react-router-dom";
import { ChatPane } from "@/components/ChatPane";
import { usePeopleStore } from "@/store/people";
import type { Bot } from "../../../apps/web/src/shared/api/bots";
import type { CatalogModel } from "../../../apps/web/src/shared/api/models";
import { AppQueryProvider } from "../query-provider";

const sendMock = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/bots-api", () => ({
  botsApi: {
    send: (...args: unknown[]) => sendMock(...args),
    abort: vi.fn(),
    reset: vi.fn(),
    read: vi.fn(),
    capabilities: vi.fn().mockResolvedValue([]),
    pastChats: vi.fn().mockResolvedValue([]),
    tools: vi.fn().mockResolvedValue([
      {
        name: "mcp__github__list_issues",
        label: "List issues",
        description: "Open issues",
        connection: { slug: "github", name: "GitHub" },
      },
    ]),
  },
}));

vi.mock("@/lib/skills-api", () => ({
  skillsApi: {
    list: vi.fn().mockResolvedValue([
      { id: "s1", name: "show-me", description: "Explain it visually" },
      { id: "s2", name: "shopping", description: "Not this bot's" },
      { id: "s3", name: "summarize", description: "Summarize the thread" },
    ]),
  },
}));

vi.mock("@/lib/sse", () => ({
  subscribeSse: vi.fn(() => ({ close: () => undefined })),
}));

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
  skillIds: ["s1", "s3"],
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
  sendMock.mockClear();
  localStorage.clear();
  usePeopleStore.setState({ role: "owner" });
});

describe("ChatPane slash skills", () => {
  it("lists the bot's skills on / and sends the picked one as /name", async () => {
    const composer = renderPane();

    await user.type(composer, "/s");
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(2));
    expect(screen.getByRole("listbox", { name: "Commands, skills and tools" })).toHaveTextContent(
      "show-me",
    );
    expect(screen.queryByText("shopping")).not.toBeInTheDocument();

    await user.type(composer, "h{Enter}");
    expect(composer.value).toBe("/show-me ");
    await user.type(composer, "draw the repo{Enter}");

    await waitFor(() => expect(sendMock).toHaveBeenCalled());
    expect(sendMock.mock.calls[0]![2]).toBe("/show-me draw the repo");
  });

  it("lists the bot's tools on / and sends a picked connection with the message", async () => {
    const composer = renderPane();

    await user.type(composer, "/git");
    await waitFor(() =>
      expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
        "githubEvery GitHub tool (1)",
        "List issuesGitHub · Open issues",
      ]),
    );
    await user.keyboard("{Enter}");
    expect(composer.value).toBe("");
    expect(screen.getByTestId("tool-chips")).toHaveTextContent("GitHub (all tools)");

    await user.type(composer, "what is open?{Enter}");
    await waitFor(() => expect(sendMock).toHaveBeenCalled());
    expect(sendMock.mock.calls[0]![2]).toBe("what is open?");
    expect(sendMock.mock.calls[0]![6]).toEqual(["mcp__github__*"]);
    expect(screen.queryByTestId("tool-chips")).not.toBeInTheDocument();
  });
});
