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
import type { ToolChoice } from "@tiny-agents/code/contracts";
import type { Bot, SendMessageBody } from "../../../apps/web/src/shared/api/bots";
import type { Skill } from "../../../apps/web/src/shared/api/skills";
import type { CatalogModel } from "../../../apps/web/src/shared/api/models";
import { AppQueryProvider } from "../query-provider";
import { chatBackend } from "./chat-backend";

vi.mock("@/lib/sse", async () => (await import("../fakes/sse")).sseModule);

const skill = (id: string, name: string, description: string): Skill => ({
  id,
  name,
  description,
  body: "",
  files: [],
  source: "manual",
  sourceUrl: null,
  allBots: false,
  botIds: [],
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
});

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
  api = chatBackend(HOST);
  api.get("/skills", (): Skill[] => [
    skill("s1", "show-me", "Explain it visually"),
    skill("s2", "shopping", "Not this bot's"),
    skill("s3", "summarize", "Summarize the thread"),
  ]);
  api.get("/bots/host/tools", (): ToolChoice[] => [
    {
      name: "mcp__github__list_issues",
      label: "List issues",
      description: "Open issues",
      connection: { slug: "github", name: "GitHub" },
    },
  ]);
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

    await waitFor(() => expect(sends()).toHaveLength(1));
    expect(sends()[0]!.body.text).toBe("/show-me draw the repo");
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
    await waitFor(() => expect(sends()).toHaveLength(1));
    expect(sends()[0]!.body.text).toBe("what is open?");
    expect(sends()[0]!.body.tools).toEqual(["mcp__github__*"]);
    expect(screen.queryByTestId("tool-chips")).not.toBeInTheDocument();
  });
});
