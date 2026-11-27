import React from "react";
import { render as renderPlain, screen, within } from "@testing-library/react";
import { AppQueryProvider } from "../query-provider";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { BotDialog } from "@/components/BotDialog";
import type {
  Bot,
  BotUpdateBody,
  CapabilityInfo,
  CapabilityList,
  ToolPermissionsData,
} from "../../../apps/web/src/shared/api/bots";
import type { Connection } from "../../../apps/web/src/shared/api/connections";
import type { CatalogModel } from "../../../apps/web/src/shared/api/models";
import type { GuestList } from "../../../apps/web/src/shared/api/people";
import type { Skill } from "../../../apps/web/src/shared/api/skills";
import { fakeApi } from "../fakes/api";

const render = (ui: React.ReactElement) => renderPlain(ui, { wrapper: AppQueryProvider });

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const many: CapabilityInfo["tools"] = Array.from({ length: 12 }, (_, i) => ({
  name: `notion_tool_${i}`,
  label: `Ran Notion tool ${i}`,
  askLabel: i === 3 ? "delete a Notion page" : `run Notion tool ${i}`,
  description: i === 3 ? "Remove a page" : "Do a Notion thing",
  readOnly: i % 2 === 0,
}));

const CAPABILITIES: CapabilityInfo[] = [
  { id: "notion", kind: "toolkit", name: "Notion", description: "Docs", tools: many },
  {
    id: "tasks",
    kind: "toolkit",
    name: "Tasks",
    description: "Tasks",
    tools: [{ name: "tasks.add", label: "Added task", description: "Create a task" }],
  },
];

const models: CatalogModel[] = [
  {
    id: "m1",
    name: "Model 1",
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
  },
];

const bot: Bot = {
  id: "b1",
  conversationId: "c1",
  name: "Chief",
  description: "",
  systemPrompt: "",
  modelId: "m1",
  chatStartedAt: "2026-01-01T00:00:00.000Z",
  toolPermissions: {},
  skillIds: [],
  connectionIds: [],
  connectionCapabilities: [],
  guestIds: [],
  memoryEnabled: false,
  autoReview: false,
  yoloByDefault: false,
  memoryCapturedThrough: null,
  browserProfile: "shared",
  projectId: null,
  lastReadAt: null,
  lastActivityAt: "2026-01-01T00:00:00.000Z",
  lastMessagePreview: null,
  pinnedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

let api: ReturnType<typeof fakeApi>;

beforeEach(() => {
  api = fakeApi();
  api.get("/capabilities", (): CapabilityList => ({ capabilities: CAPABILITIES }));
  api.get("/tool-permissions", (): ToolPermissionsData => ({ permissions: {} }));
  api.get("/skills", (): Skill[] => []);
  api.get("/connections", (): Connection[] => []);
  api.get("/people", (): GuestList => ({ guests: [] }));
  api.patch<BotUpdateBody>("/bots/b1", (request): Bot => ({ ...bot, ...request.body }));
});

describe("BotDialog tools at scale (issue #91)", () => {
  it("collapses a big toolkit, summarises it, and sets all its tools at once", async () => {
    const user = userEvent.setup();
    render(<BotDialog open onOpenChange={() => {}} models={models} bot={bot} onSaved={() => {}} />);
    await user.click(await screen.findByRole("tab", { name: "Tools" }));

    const header = await screen.findByRole("button", { name: /Notion/ });
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("12 tools · 6 allow · 6 ask")).toBeInTheDocument();
    expect(screen.queryByText("Delete a Notion page")).toBeNull();
    expect(screen.getByText("Added task")).toBeInTheDocument();

    const all = screen.getByRole("radiogroup", { name: "All Notion tools" });
    expect(screen.getByText("Mixed")).toBeInTheDocument();
    await user.click(within(all).getByRole("radio", { name: "Off" }));
    expect(screen.getByText("12 tools · 12 off")).toBeInTheDocument();
    expect(screen.queryByText("Mixed")).toBeNull();

    await user.click(header);
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Delete a Notion page")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(api.sent("PATCH", "/bots/b1").at(-1)?.body).toMatchObject({
      toolPermissions: { notion_tool_0: "off", notion_tool_11: "off" },
    });
  });

  it("searches across toolkits and opens the groups with matches", async () => {
    const user = userEvent.setup();
    render(<BotDialog open onOpenChange={() => {}} models={models} bot={bot} onSaved={() => {}} />);
    await user.click(await screen.findByRole("tab", { name: "Tools" }));

    await user.type(
      await screen.findByRole("searchbox", { name: "Search tools" }),
      "notion delete",
    );
    expect(screen.getByText("Delete a Notion page")).toBeInTheDocument();
    expect(screen.queryByText("Run Notion tool 1")).toBeNull();
    expect(screen.queryByText("Added task")).toBeNull();

    await user.clear(screen.getByRole("searchbox", { name: "Search tools" }));
    await user.type(screen.getByRole("searchbox", { name: "Search tools" }), "zzz");
    expect(screen.getByText("No tools match “zzz”.")).toBeInTheDocument();
  });

  it("applies the Ask for everything preset", async () => {
    const user = userEvent.setup();
    render(<BotDialog open onOpenChange={() => {}} models={models} bot={bot} onSaved={() => {}} />);
    await user.click(await screen.findByRole("tab", { name: "Tools" }));

    await user.click(await screen.findByRole("button", { name: "Ask for everything" }));
    expect(screen.getByText("12 tools · 12 ask")).toBeInTheDocument();
    expect(screen.getByText("13 ask")).toBeInTheDocument();
  });
});
