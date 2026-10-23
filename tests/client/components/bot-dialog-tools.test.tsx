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
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vite-plus/test";
import { BotDialog } from "@/components/BotDialog";
import { botsApi, type Bot, type ModelInfo } from "@/lib/bots-api";

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

const models: ModelInfo[] = [
  {
    id: "m1",
    name: "Model 1",
    family: "other",
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

    // A writable tool defaults to Ask.
    expect(ask).toHaveAttribute("data-state", "on");

    await user.click(off);
    expect(off).toHaveAttribute("data-state", "on");
    expect(ask).toHaveAttribute("data-state", "off");
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
    // A toolkit that still needs setup says how, and offers no tools yet.
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
      "data-state",
      "on",
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
