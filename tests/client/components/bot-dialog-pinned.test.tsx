/**
 * @vitest-environment jsdom
 *
 * `BotDialog` pinned section by section: the element tree with roles, names,
 * test ids and text, and the whole markup, for a new bot and for each tab of
 * an edit (Profile with a taken name, a missing model and a long prompt;
 * Tools with its toolkits open, closed and not set up, the browser profile,
 * a search with and without matches, and connections; Skills and Sharing
 * empty and filled), and the inline delete confirmation. Recorded on the
 * one-file dialog before it was split, so the split must render each the
 * same.
 */
import React from "react";
import { act, render as renderPlain, screen, waitFor } from "@testing-library/react";
import { AppQueryProvider } from "../query-provider";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { BotDialog } from "@/components/BotDialog";
import type {
  Bot,
  CapabilityInfo,
  CapabilityList,
  ToolPermissionsData,
} from "../../../apps/web/src/shared/api/bots";
import type { Connection } from "../../../apps/web/src/shared/api/connections";
import type { CatalogModel } from "../../../apps/web/src/shared/api/models";
import type { Guest, GuestList } from "../../../apps/web/src/shared/api/people";
import type { Skill } from "../../../apps/web/src/shared/api/skills";
import { markup, outline } from "../dom-outline";
import { ApiFailure, fakeApi } from "../fakes/api";

const render = (ui: React.ReactElement) => renderPlain(ui, { wrapper: AppQueryProvider });

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const tool = (name: string, label: string, extra: object = {}) => ({
  name,
  label,
  description: `${label}, described`,
  ...extra,
});

const CAPABILITIES: CapabilityInfo[] = [
  {
    id: "tasks",
    kind: "toolkit",
    name: "Tasks",
    description: "Create and manage your tasks",
    tools: [
      tool("tasks.add", "Added task"),
      tool("tasks.list", "Listed tasks", { readOnly: true }),
      tool("tasks.delete", "Deleted task", { askOnly: true }),
    ],
  },
  {
    id: "browser",
    kind: "toolkit",
    name: "Browser",
    description: "A real browser the bot drives",
    tools: [tool("browser_navigate", "Opened a page", { askLabel: "open a page" })],
  },
  {
    id: "big",
    kind: "toolkit",
    name: "Big",
    description: "Many tools",
    tools: Array.from({ length: 10 }, (_, i) => tool(`big_${i}`, `Big tool ${i}`)),
  },
  {
    id: "vision",
    kind: "toolkit",
    name: "Vision",
    description: "See attached images",
    auto: true,
    tools: [tool("see_image", "Looked at an image")],
  },
  {
    id: "web",
    kind: "toolkit",
    name: "Web",
    description: "Search and read web pages",
    setupHint: "Set CLOUDFLARE_API_KEY to enable web search.",
    tools: [tool("web_search", "Searched the web")],
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

const skill = (id: string, name: string, description: string, body: string): Skill => ({
  id,
  name,
  description,
  body,
  files: [],
  source: "manual",
  sourceUrl: null,
  allBots: false,
  botIds: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const guest = (id: number, name: string, email: string): Guest => ({
  id,
  name,
  email,
  createdAt: "2026-01-01T00:00:00.000Z",
  botIds: [],
});

const connectionTool = (name: string, enabled: boolean): Connection["tools"][number] => ({
  name,
  serverName: name,
  label: name,
  description: "",
  readOnly: false,
  enabled,
});

const connection = (
  id: string,
  name: string,
  status: Connection["status"],
  tools: Connection["tools"],
): Connection => ({
  id,
  name,
  slug: name.toLowerCase(),
  url: `https://${name.toLowerCase()}.example/mcp`,
  transport: "streamable-http",
  authType: "none",
  headerName: null,
  hasSecret: false,
  secretRef: null,
  tools,
  allBots: false,
  botIds: [],
  status,
  createdAt: "2026-01-01T00:00:00.000Z",
});

let api: ReturnType<typeof fakeApi>;

beforeEach(() => {
  api = fakeApi();
  api.get("/tool-permissions", (): ToolPermissionsData => ({ permissions: {} }));
  api.get("/capabilities", (): CapabilityList => ({ capabilities: CAPABILITIES }));
  api.get("/skills", (): Skill[] => [
    skill("s1", "Deploy", "Ships the app", "x"),
    skill("s2", "Review", "Reviews code", "y"),
  ]);
  api.get("/people", (): GuestList => ({
    guests: [guest(7, "Grace", "grace@example.com"), guest(8, " ", "linus@example.com")],
  }));
  api.get("/connections", (): Connection[] => [
    connection("k1", "Notion", "connected", [
      connectionTool("search", true),
      connectionTool("write", false),
    ]),
    connection("k2", "Linear", "needs_auth", []),
  ]);
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
  it("a new bot", async () => {
    await mount({ bot: null });
    pin();
  });

  it("a new bot before the catalog", async () => {
    await mount({ bot: null, models: [], defaultModelId: undefined });
    pin();
  });

  it("edit: Profile", async () => {
    await mount();
    pin();
  });

  it("edit: Profile with a missing model and a long prompt", async () => {
    await mount({ bot: { ...bot, modelId: "gone", systemPrompt: "x".repeat(9_000) } });
    pin();
  });

  it("edit: a taken name", async () => {
    api.patch("/bots/b1", () => {
      throw new ApiFailure(409, "A bot named Chief exists", "CONFLICT");
    });
    await mount();
    await user.click(screen.getByRole("tab", { name: "Skills" }));
    await hoverShown();
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    pin();
  });

  it("edit: Tools", async () => {
    await mount();
    await user.click(screen.getByRole("tab", { name: "Tools" }));
    await hoverShown();
    pin("closed big");
    await user.click(screen.getByRole("button", { name: /^Big/ }));
    pin("opened big");
    await user.click(screen.getByRole("button", { name: /^Tasks/ }));
    pin("closed tasks");
  });

  it("edit: Tools, a group set to mixed and then all", async () => {
    await mount();
    await user.click(screen.getByRole("tab", { name: "Tools" }));
    await hoverShown();
    await user.click(screen.getByRole("button", { name: "Allow read-only" }));
    pin("read-only");
    await user.click(screen.getByRole("button", { name: "Ask for everything" }));
    pin("ask all");
  });

  it("edit: Tools, searching", async () => {
    await mount();
    await user.click(screen.getByRole("tab", { name: "Tools" }));
    await hoverShown();
    await user.type(screen.getByRole("searchbox", { name: "Search tools" }), "task");
    pin("matches");
    await user.clear(screen.getByRole("searchbox", { name: "Search tools" }));
    await user.type(screen.getByRole("searchbox", { name: "Search tools" }), "zzz");
    pin("no match");
  });

  it("edit: Skills", async () => {
    await mount();
    await user.click(screen.getByRole("tab", { name: "Skills" }));
    await hoverShown();
    pin();
  });

  it("edit: Sharing", async () => {
    await mount();
    await user.click(screen.getByRole("tab", { name: "Sharing" }));
    await hoverShown();
    pin();
  });

  it("edit: the delete confirmation", async () => {
    let finish: () => void = () => {};
    api.delete("/bots/b1", () => new Promise<void>((resolve) => (finish = resolve)));
    await mount();
    const deletes = screen.getAllByRole("button", { name: "Delete bot" });
    await user.click(deletes[deletes.length - 1]!);
    pin("asking");
    const confirms = screen.getAllByRole("button", { name: "Delete bot" });
    await user.click(confirms[confirms.length - 1]!);
    pin("deleting");
    await act(async () => finish());
  });

  it("edit: saving", async () => {
    api.patch("/bots/b1", () => new Promise(() => {}));
    await mount();
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    pin();
  });
});
