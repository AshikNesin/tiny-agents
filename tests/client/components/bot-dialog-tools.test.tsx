/**
 * @vitest-environment jsdom
 *
 * BotDialog Tools tab: the per-tool Allow/Ask/Off segmented control must
 * actually change the permission on click (regression repro).
 */
import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vite-plus/test";
import { BotDialog } from "@/components/BotDialog";
import type { Bot, ModelInfo } from "@/lib/bots-api";

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
    ]),
    update: vi.fn(),
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
  toolkits: ["tasks"],
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
