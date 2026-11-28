/**
 * @vitest-environment jsdom
 *
 * Memory, a skill's page and a connection's page pinned state by state: the
 * element tree with roles, names, test ids and text, and the whole markup.
 * Memory: loading, failed, no bots, bots with and without memories (every
 * category, archived, superseded, expiring, manual), a search with and
 * without matches, the archived rows open, and the editor for a new and an
 * archived memory. A skill: loading, failed, edited (Save on), no bots,
 * used by none and by some, its preview and its delete prompt. A
 * connection: loading, failed, each status with and without tools, no bots,
 * bots, and its remove prompt for none, one and several bots. Recorded
 * before React Doctor's complexity findings on the three were split out
 * so the split must render each the same.
 * Markdown is a stand-in.
 */
import React from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { MemoryRouter, RouterProvider, createMemoryRouter } from "react-router-dom";
import { GrootUIProvider } from "@groot/ui";
import { MemoryPage } from "@/pages/memory/Memory";
import { SkillDetail } from "@/pages/skills/SkillDetail";
import { ConnectionDetail } from "@/pages/connections/ConnectionDetail";
import { StepUpProvider } from "@/components/vault/StepUp";
import { useBotsStore } from "@/store/bots";
import type { Bot, BotListEntry } from "../../../apps/web/src/shared/api/bots";
import type { MemoryList, MemoryRecord } from "../../../apps/web/src/shared/api/memories";
import type { Skill } from "../../../apps/web/src/shared/api/skills";
import type { Connection } from "../../../apps/web/src/shared/api/connections";
import { FIXED_NOW } from "../../test-clock";
import { ApiFailure, fakeApi } from "../fakes/api";
import { AppQueryProvider } from "../query-provider";
import { markup, outline } from "../dom-outline";

vi.mock("@/lib/sse", async () => (await import("../fakes/sse")).sseModule);
vi.mock("streamdown", () => ({
  Streamdown: ({ children }: { children?: React.ReactNode }) => (
    <div data-stand-in="streamdown">{children}</div>
  ),
}));

function pin(name?: string) {
  expect(outline(document.body)).toMatchSnapshot(name ? `${name} outline` : "outline");
  expect(markup(document.body)).toMatchSnapshot(name ? `${name} markup` : "markup");
}

const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

const hoverShown = () =>
  waitFor(() => {
    const highlights = document.querySelectorAll<HTMLElement>(
      "[role=tablist] > .bg-foreground\\/5",
    );
    expect(highlights.length).toBeGreaterThan(0);
    for (const el of highlights) expect(el.style.opacity).toBe("1");
  });
const user = userEvent.setup();
const DAY = 24 * 60 * 60_000;

let api: ReturnType<typeof fakeApi>;
const pending = () => new Promise(() => {});
const failing = (status: number, message: string) => () => {
  throw new ApiFailure(status, message);
};

beforeEach(() => {
  api = fakeApi();
  api.get("/skills", (): Skill[] => []);
});

function listed(id: string, name: string, description = ""): BotListEntry {
  return {
    id,
    conversationId: `c-${id}`,
    name,
    description,
    modelId: null,
    lastMessagePreview: null,
    lastActivityAt: FIXED_NOW,
    lastReadAt: null,
    unread: false,
    replying: false,
    approvals: 0,
    questions: 0,
    pinnedAt: null,
    projectId: null,
  };
}

function bot(entry: BotListEntry, memoryEnabled: boolean): Bot {
  return {
    id: entry.id,
    name: entry.name,
    description: entry.description,
    systemPrompt: "",
    modelId: null,
    conversationId: entry.conversationId,
    chatStartedAt: FIXED_NOW,
    lastReadAt: null,
    lastActivityAt: FIXED_NOW,
    lastMessagePreview: null,
    memoryEnabled,
    autoReview: false,
    yoloByDefault: false,
    memoryCapturedThrough: null,
    pinnedAt: null,
    browserProfile: "shared",
    projectId: null,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    toolPermissions: {},
    skillIds: [],
    connectionIds: [],
    connectionCapabilities: [],
    guestIds: [],
  };
}

function memory(partial: Partial<MemoryRecord> & { id: string; botId: string }): MemoryRecord {
  return {
    text: "Prefers TypeScript over JavaScript",
    category: "preference",
    status: "active",
    source: "capture",
    until: null,
    supersededById: null,
    supersededAt: null,
    createdAt: new Date(Date.now() - 2 * DAY).toISOString(),
    updatedAt: new Date(Date.now() - DAY).toISOString(),
    ...partial,
  };
}

const MEMORY_BOTS = [
  listed("b1", "Helper Bot"),
  listed("b2", "Journal Bot"),
  listed("b3", "Quiet Bot"),
  listed("b4", "Off Bot"),
];

const MEMORIES: Record<string, MemoryRecord[]> = {
  b1: [
    memory({ id: "m1", botId: "b1" }),
    memory({ id: "m2", botId: "b1", text: "Lives in Pune", category: "fact", source: "manual" }),
    memory({
      id: "m3",
      botId: "b1",
      text: "Ship v2 by March",
      category: "goal",
      until: new Date(Date.now() + 10 * DAY).toISOString(),
    }),
    memory({ id: "m4", botId: "b1", text: "Runs at 6am", category: "habit" }),
    memory({
      id: "m5",
      botId: "b1",
      text: "Prefers tabs",
      status: "superseded",
      supersededById: "m1",
      supersededAt: new Date(Date.now() - DAY).toISOString(),
    }),
    memory({ id: "m6", botId: "b1", text: "Old project Atlas", status: "archived" }),
  ],
  b2: [memory({ id: "m7", botId: "b2", text: "Journals every night", category: "habit" })],
  b3: [],
  b4: [],
};

function loadMemory(rows: Record<string, MemoryRecord[]> = MEMORIES, bots = MEMORY_BOTS) {
  api.get("/bots", () => bots);
  api.get("/bots/:id", ({ params }) =>
    bot(
      bots.find((entry) => entry.id === params.id)!,
      params.id !== "b4",
    ),
  );
  api.get("/bots/:id/memories", ({ params }): MemoryList => ({ memories: rows[params.id!] ?? [] }));
}

async function mountMemory() {
  render(
    <AppQueryProvider>
      <MemoryRouter>
        <GrootUIProvider>
          <MemoryPage />
        </GrootUIProvider>
      </MemoryRouter>
    </AppQueryProvider>,
  );
  await settle();
  await settle();
}

async function memoryLoaded() {
  await screen.findByText("Journals every night");
  await waitFor(() => {
    for (const { id } of MEMORY_BOTS) {
      expect(api.sent("GET", `/bots/${id}`)).toHaveLength(1);
      expect(api.sent("GET", `/bots/${id}/memories`)).toHaveLength(1);
    }
  });
  await settle();
  await settle();
  await settle();
}

describe("Memory, pinned", () => {
  it("while loading", async () => {
    api.get("/bots", pending);
    await mountMemory();
    pin();
  });

  it("after a failed load", async () => {
    api.get("/bots", failing(500, "Server down"));
    await mountMemory();
    await screen.findByText("Couldn't load memories");
    pin();
  });

  it("with no bots", async () => {
    loadMemory({}, []);
    await mountMemory();
    await screen.findByText("No bots yet");
    pin();
  });

  it("with bots with and without memories", async () => {
    loadMemory();
    await mountMemory();
    await memoryLoaded();
    pin();
  });

  it("the archived rows open", async () => {
    loadMemory();
    await mountMemory();
    await memoryLoaded();
    await user.click(screen.getByRole("button", { name: /archived/i }));
    pin();
  });

  it("searching", async () => {
    loadMemory();
    await mountMemory();
    await memoryLoaded();
    await user.type(screen.getByRole("searchbox", { name: "Search memories" }), "prefers");
    pin("matches");
    await user.clear(screen.getByRole("searchbox", { name: "Search memories" }));
    await user.type(screen.getByRole("searchbox", { name: "Search memories" }), "zzz");
    pin("no match");
  });

  it("the editor for a new memory", async () => {
    loadMemory();
    await mountMemory();
    await memoryLoaded();
    await user.click(screen.getByRole("button", { name: "Add memory for Quiet Bot" }));
    await screen.findByRole("dialog");
    pin();
  });
});

const skill = (partial: Partial<Skill> = {}): Skill => ({
  id: "s1",
  name: "deploy",
  description: "Ships the app",
  body: "# Deploy\n\nRun the script.",
  files: [{ path: "scripts/deploy.sh", content: "echo deploy" }],
  source: "manual",
  sourceUrl: null,
  allBots: false,
  botIds: ["b1"],
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  ...partial,
});

const SKILL_BOTS = [listed("b1", "Helper Bot", "Helps"), listed("b2", "Journal Bot")];

async function mountSkill() {
  const router = createMemoryRouter(
    [
      { path: "/skills/:id", element: <SkillDetail id="s1" /> },
      { path: "/skills", element: <p>Skills</p> },
    ],
    { initialEntries: ["/skills/s1"] },
  );
  render(
    <AppQueryProvider>
      <GrootUIProvider>
        <RouterProvider router={router} />
      </GrootUIProvider>
    </AppQueryProvider>,
  );
  await settle();
  await settle();
}

describe("SkillDetail, pinned", () => {
  it("while loading", async () => {
    api.get("/skills/:id", pending);
    api.get("/bots", pending);
    await mountSkill();
    pin();
  });

  it("after a failed load", async () => {
    api.get("/skills/:id", failing(404, "Gone"));
    api.get("/bots", () => SKILL_BOTS);
    await mountSkill();
    await screen.findByText("Couldn't load skill");
    pin();
  });

  it("used by one bot, bots still loading", async () => {
    api.get("/skills/:id", () => skill());
    api.get("/bots", pending);
    await mountSkill();
    pin();
  });

  it("used by one bot", async () => {
    api.get("/skills/:id", () => skill());
    api.get("/bots", () => SKILL_BOTS);
    await mountSkill();
    pin();
  });

  it("used by none", async () => {
    api.get("/skills/:id", () => skill({ botIds: [], files: [], body: "" }));
    api.get("/bots", () => SKILL_BOTS);
    await mountSkill();
    pin("edit");
    await user.click(screen.getByRole("tab", { name: "Preview" }));
    await hoverShown();
    pin("empty preview");
  });

  it("no bots", async () => {
    api.get("/skills/:id", () => skill({ botIds: [] }));
    api.get("/bots", () => []);
    await mountSkill();
    pin();
  });

  it("edited, previewed, then asked to delete", async () => {
    api.get("/skills/:id", () => skill({ botIds: ["b1", "b2"] }));
    api.get("/bots", () => SKILL_BOTS);
    await mountSkill();
    await user.type(screen.getByLabelText("Description"), " now");
    pin("dirty");
    await user.click(screen.getByRole("tab", { name: "Preview" }));
    await hoverShown();
    pin("preview");
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await screen.findByRole("dialog");
    pin("delete");
  });
});

const connection = (partial: Partial<Connection> = {}): Connection => ({
  id: "c1",
  name: "Notion",
  slug: "notion",
  url: "https://mcp.notion.test/mcp",
  transport: "http",
  authType: "oauth",
  headerName: null,
  hasSecret: false,
  secretRef: null,
  tools: [
    {
      name: "mcp__notion__search",
      serverName: "search",
      label: "Search pages",
      description: "Finds pages",
      readOnly: true,
      enabled: true,
    },
    {
      name: "mcp__notion__create",
      serverName: "create",
      label: "Create page",
      description: "",
      readOnly: false,
      enabled: false,
    },
  ],
  allBots: false,
  botIds: ["b1"],
  status: "connected",
  createdAt: new Date(Date.now() - 3 * DAY).toISOString(),
  ...partial,
});

const CONNECTION_BOTS = SKILL_BOTS;

function seedBots(bots: BotListEntry[] | null) {
  useBotsStore.setState({
    bots: bots ?? [],
    loading: bots === null,
  });
}

async function mountConnection() {
  render(
    <AppQueryProvider>
      <MemoryRouter>
        <GrootUIProvider>
          <StepUpProvider>
            <ConnectionDetail id="c1" />
          </StepUpProvider>
        </GrootUIProvider>
      </MemoryRouter>
    </AppQueryProvider>,
  );
  await settle();
  await settle();
}

describe("ConnectionDetail, pinned", () => {
  it("while loading", async () => {
    seedBots(CONNECTION_BOTS);
    api.get("/connections/:id", pending);
    await mountConnection();
    pin();
  });

  it("after a failed load", async () => {
    seedBots(CONNECTION_BOTS);
    api.get("/connections/:id", failing(404, "Gone"));
    await mountConnection();
    await screen.findByText("Couldn't load connection");
    pin();
  });

  it("connected, with tools and bots", async () => {
    seedBots(CONNECTION_BOTS);
    api.get("/connections/:id", () => connection());
    await mountConnection();
    pin();
  });

  it.each(["connecting", "needs_auth", "error", "connected"] as const)(
    "%s, without tools, bots loading",
    async (status) => {
      seedBots(null);
      api.get("/connections/:id", () =>
        connection({
          status,
          tools: [],
          botIds: [],
          ...(status === "error" ? { error: "502 from the server" } : {}),
        }),
      );
      await mountConnection();
      pin();
    },
  );

  it("no bots", async () => {
    seedBots([]);
    api.get("/connections/:id", () => connection({ botIds: [] }));
    await mountConnection();
    pin();
  });

  it.each([
    ["none", []],
    ["one", ["b1"]],
    ["several", ["b1", "b2"]],
  ])("the remove prompt for %s", async (_name, botIds) => {
    seedBots(CONNECTION_BOTS);
    api.get("/connections/:id", () => connection({ botIds }));
    await mountConnection();
    await user.click(screen.getByRole("button", { name: "Remove" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Remove connection?")).toBeTruthy();
    pin();
  });
});
