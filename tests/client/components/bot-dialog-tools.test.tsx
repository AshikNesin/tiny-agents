/**
 * @vitest-environment jsdom
 *
 * BotDialog Tools tab: the per-tool Allow/Ask/Off segmented control must
 * actually change the permission on click (regression repro). Every bot
 * has every toolkit, so there are no toolkit switches, and the automatic
 * capabilities are not shown. The Browser toolkit offers the shared or the
 * bot's own browser profile.
 */
import React from "react";
import { render as renderPlain, screen, within } from "@testing-library/react";
import { AppQueryProvider } from "../query-provider";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vite-plus/test";
import { BotDialog } from "@/components/BotDialog";
import type { Bot } from "../../../apps/web/src/shared/api/bots";
import type { CatalogModel } from "../../../apps/web/src/shared/api/models";
import { botsApi } from "@/lib/bots-api";

const render = (ui: React.ReactElement) => renderPlain(ui, { wrapper: AppQueryProvider });

vi.mock("@/lib/bots-api", () => ({
  botsApi: {
    capabilities: vi.fn().mockResolvedValue([
      {
        id: "tasks",
        kind: "toolkit",
        name: "Tasks",
        description: "Create and manage your tasks",
        tools: [{ name: "tasks.add", label: "Added task", description: "Create a task" }],
      },
      {
        id: "browser",
        kind: "toolkit",
        name: "Browser",
        description: "A real browser the bot drives",
        tools: [{ name: "browser_navigate", label: "Opened a page", description: "Open a URL" }],
      },
      {
        id: "vision",
        kind: "toolkit",
        name: "Vision",
        description: "See attached images",
        auto: true,
        tools: [{ name: "see_image", label: "Looked at an image", description: "See an image" }],
      },
      { id: "today", kind: "toolkit", name: "Today", description: "Date", auto: true, tools: [] },
      {
        id: "web",
        kind: "toolkit",
        name: "Web",
        description: "Search and read web pages",
        setupHint: "Set CLOUDFLARE_API_KEY to enable web search.",
        tools: [{ name: "web_search", label: "Searched the web", description: "Search" }],
      },
    ]),
    update: vi.fn(async (_id: string, payload: object) => ({ ...payload })),
    create: vi.fn(),
  },
}));
vi.mock("@/lib/skills-api", () => ({ skillsApi: { list: vi.fn().mockResolvedValue([]) } }));
vi.mock("@/lib/connections-api", () => ({
  connectionsApi: { list: vi.fn().mockResolvedValue([]) },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

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

const bot = {
  id: "b1",
  conversationId: "c1",
  name: "Chief",
  description: "",
  systemPrompt: "",
  modelId: "m1",
  toolPermissions: {},
  skillIds: [],
  connectionIds: [],
  memoryEnabled: false,
  lastReadAt: null,
  lastActivityAt: "2026-01-01T00:00:00.000Z",
  lastMessagePreview: null,
  pinnedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
} as unknown as Bot;

describe("BotDialog tool permissions", () => {
  it("changes a tool permission when clicking Allow/Ask/Off", async () => {
    const user = userEvent.setup();
    render(<BotDialog open onOpenChange={() => {}} models={models} bot={bot} onSaved={() => {}} />);

    await user.click(await screen.findByRole("tab", { name: "Tools" }));

    const group = await screen.findByRole("radiogroup", { name: "Added task permission" });
    const off = within(group).getByRole("radio", { name: "Off" });
    const ask = within(group).getByRole("radio", { name: "Ask" });

    expect(ask).toHaveAttribute("aria-checked", "true");

    await user.click(off);
    expect(off).toHaveAttribute("aria-checked", "true");
    expect(ask).toHaveAttribute("aria-checked", "false");
  });
});

describe("BotDialog tools list", () => {
  it("lists every toolkit without switches and hides the automatic ones", async () => {
    const user = userEvent.setup();
    render(<BotDialog open onOpenChange={() => {}} models={models} bot={bot} onSaved={() => {}} />);
    await user.click(await screen.findByRole("tab", { name: "Tools" }));

    expect(await screen.findByText("Opened a page")).toBeInTheDocument();
    expect(screen.getByText("Added task")).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: /^Enable / })).toBeNull();
    expect(screen.queryByText("Vision")).toBeNull();
    expect(screen.queryByText("Today")).toBeNull();
    expect(screen.getByText("Set CLOUDFLARE_API_KEY to enable web search.")).toBeInTheDocument();
    expect(screen.queryByText("Searched the web")).toBeNull();
  });
});

describe("BotDialog browser profile", () => {
  it("defaults to the shared profile and saves a switch to the bot's own", async () => {
    const user = userEvent.setup();
    render(<BotDialog open onOpenChange={() => {}} models={models} bot={bot} onSaved={() => {}} />);

    await user.click(await screen.findByRole("tab", { name: "Tools" }));
    const group = await screen.findByRole("radiogroup", { name: "Browser profile" });
    expect(within(group).getByRole("radio", { name: "Shared" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await user.click(within(group).getByRole("radio", { name: "Own" }));
    expect(screen.getByText("A browser of its own, with separate sign-ins.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(botsApi.update).toHaveBeenCalledWith(
      "b1",
      expect.objectContaining({ browserProfile: "own" }),
    );
  });
});

describe("BotDialog tools at scale (issue #91)", () => {
  const many = Array.from({ length: 12 }, (_, i) => ({
    name: `notion_tool_${i}`,
    label: `Ran Notion tool ${i}`,
    askLabel: i === 3 ? "delete a Notion page" : `run Notion tool ${i}`,
    description: i === 3 ? "Remove a page" : "Do a Notion thing",
    readOnly: i % 2 === 0,
  }));
  const withNotion = () =>
    vi.mocked(botsApi.capabilities).mockResolvedValueOnce([
      { id: "notion", kind: "toolkit", name: "Notion", description: "Docs", tools: many },
      {
        id: "tasks",
        kind: "toolkit",
        name: "Tasks",
        description: "Tasks",
        tools: [{ name: "tasks.add", label: "Added task", description: "Create a task" }],
      },
    ] as never);

  it("collapses a big toolkit, summarises it, and sets all its tools at once", async () => {
    withNotion();
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
    const saved = vi.mocked(botsApi.update).mock.lastCall?.[1] as {
      toolPermissions: Record<string, string>;
    };
    expect(saved.toolPermissions.notion_tool_0).toBe("off");
    expect(saved.toolPermissions.notion_tool_11).toBe("off");
  });

  it("searches across toolkits and opens the groups with matches", async () => {
    withNotion();
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
    withNotion();
    const user = userEvent.setup();
    render(<BotDialog open onOpenChange={() => {}} models={models} bot={bot} onSaved={() => {}} />);
    await user.click(await screen.findByRole("tab", { name: "Tools" }));

    await user.click(await screen.findByRole("button", { name: "Ask for everything" }));
    expect(screen.getByText("12 tools · 12 ask")).toBeInTheDocument();
    expect(screen.getByText("13 ask")).toBeInTheDocument();
  });
});
