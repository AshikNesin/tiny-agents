import React from "react";
import { act, render as renderPlain, screen, waitFor } from "@testing-library/react";
import { AppQueryProvider } from "../query-provider";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { BotDialog } from "@/components/BotDialog";
import type {
  Bot,
  CapabilityList,
  ToolPermissionsData,
} from "../../../apps/web/src/shared/api/bots";
import type { Connection } from "../../../apps/web/src/shared/api/connections";
import type { CatalogModel } from "../../../apps/web/src/shared/api/models";
import type { GuestList } from "../../../apps/web/src/shared/api/people";
import type { Skill } from "../../../apps/web/src/shared/api/skills";
import { markup, outline } from "../dom-outline";
import { fakeApi } from "../fakes/api";

const render = (ui: React.ReactElement) => renderPlain(ui, { wrapper: AppQueryProvider });

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

const bot: Bot = {
  id: "b1",
  conversationId: "c1",
  name: "Chief",
  description: "Runs things",
  systemPrompt: "Be brief.",
  modelId: "m1",
  chatStartedAt: "2026-01-01T00:00:00.000Z",
  toolPermissions: { "tasks.add": "allow" },
  skillIds: ["s1"],
  connectionIds: ["k1"],
  connectionCapabilities: [],
  guestIds: [7],
  memoryEnabled: false,
  autoReview: true,
  yoloByDefault: false,
  memoryCapturedThrough: null,
  browserProfile: "own",
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
  api.get("/tool-permissions", (): ToolPermissionsData => ({ permissions: {} }));
  api.get("/capabilities", (): CapabilityList => ({ capabilities: [] }));
  api.get("/skills", (): Skill[] => []);
  api.get("/people", (): GuestList => ({ guests: [] }));
  api.get("/connections", (): Connection[] => []);
});

async function mount(props: Partial<React.ComponentProps<typeof BotDialog>> = {}) {
  const result = render(
    <BotDialog
      open
      onOpenChange={() => {}}
      models={models}
      defaultModelId="m1"
      bot={bot}
      onSaved={() => {}}
      {...props}
    />,
  );
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  return result;
}

function pin(name?: string) {
  expect(outline(document.body)).toMatchSnapshot(name ? `${name} outline` : "outline");
  expect(markup(document.body)).toMatchSnapshot(name ? `${name} markup` : "markup");
}

const hoverShown = () =>
  waitFor(() => {
    const highlights = document.querySelectorAll<HTMLElement>(
      "[role=tablist] > .bg-foreground\\/5",
    );
    expect(highlights.length).toBeGreaterThan(0);
    for (const el of highlights) expect(el.style.opacity).toBe("1");
  });
const user = userEvent.setup();

describe("BotDialog, pinned", () => {
  it("edit: Tools with nothing", async () => {
    await mount();
    await user.click(screen.getByRole("tab", { name: "Tools" }));
    await hoverShown();
    pin();
  });

  it("edit: Skills, none", async () => {
    await mount();
    await user.click(screen.getByRole("tab", { name: "Skills" }));
    await hoverShown();
    pin();
  });

  it("edit: Sharing, none", async () => {
    await mount();
    await user.click(screen.getByRole("tab", { name: "Sharing" }));
    await hoverShown();
    pin();
  });
});
