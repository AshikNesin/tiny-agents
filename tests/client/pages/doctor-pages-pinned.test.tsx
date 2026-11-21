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
 * (docs/rewrite/PLAN.md row 5.6), so the split must render each the same.
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
import type { MemoryRecord } from "../../../apps/web/src/shared/api/memories";
import type { Skill } from "../../../apps/web/src/shared/api/skills";
import type { Connection } from "../../../apps/web/src/shared/api/connections";
import { AppQueryProvider } from "../query-provider";
import { markup, outline } from "../dom-outline";

const api = vi.hoisted(() => ({
  botsList: vi.fn(),
  botsGet: vi.fn(),
  listMemories: vi.fn(),
  skillGet: vi.fn(),
  skillUpdate: vi.fn(),
  connectionGet: vi.fn(),
}));

vi.mock("@/lib/bots-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/bots-api")>();
  return {
    ...original,
    botsApi: {
      list: (...args: unknown[]) => api.botsList(...args),
      get: (...args: unknown[]) => api.botsGet(...args),
      listMemories: (...args: unknown[]) => api.listMemories(...args),
      createMemory: vi.fn(),
      update: vi.fn(),
      updateMemory: vi.fn(),
      deleteMemory: vi.fn(),
    },
  };
});
vi.mock("@/lib/skills-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/skills-api")>();
  return {
    ...original,
    skillsApi: {
      get: (...args: unknown[]) => api.skillGet(...args),
      update: (...args: unknown[]) => api.skillUpdate(...args),
      remove: vi.fn(),
      list: vi.fn().mockResolvedValue([]),
    },
  };
});
vi.mock("@/lib/connections-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/connections-api")>();
  return {
    ...original,
    connectionsApi: {
      get: (...args: unknown[]) => api.connectionGet(...args),
      update: vi.fn(),
      updateTool: vi.fn(),
      reconnect: vi.fn(),
      remove: vi.fn(),
    },
  };
});
vi.mock("@/lib/sse", () => ({ subscribeSse: vi.fn(() => ({ close: () => undefined })) }));
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

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
});

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
  { id: "b1", name: "Helper Bot" },
  { id: "b2", name: "Journal Bot" },
  { id: "b3", name: "Quiet Bot" },
  { id: "b4", name: "Off Bot" },
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
  api.botsList.mockResolvedValue(bots);
  api.botsGet.mockImplementation(async (id: string) => ({ id, memoryEnabled: id !== "b4" }));
  api.listMemories.mockImplementation(async (id: string) => ({ memories: rows[id] ?? [] }));
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
  const bots = (await api.botsList.mock.results[0]?.value) as unknown[];
  await waitFor(() => {
    expect(api.botsGet).toHaveBeenCalledTimes(bots.length);
    expect(api.listMemories).toHaveBeenCalledTimes(bots.length);
  });
  await Promise.all(api.botsGet.mock.results.map((r) => r.value));
  await Promise.all(api.listMemories.mock.results.map((r) => r.value));
  await settle();
  await settle();
}

describe("Memory, pinned", () => {
  it("while loading", async () => {
    api.botsList.mockReturnValue(new Promise(() => {}));
    await mountMemory();
    pin();
  });

  it("after a failed load", async () => {
    api.botsList.mockRejectedValue(new Error("Server down"));
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
  botIds: ["b1"],
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  ...partial,
});

const SKILL_BOTS = [
  { id: "b1", name: "Helper Bot", description: "Helps" },
  { id: "b2", name: "Journal Bot", description: "" },
];

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
    api.skillGet.mockReturnValue(new Promise(() => {}));
    api.botsList.mockReturnValue(new Promise(() => {}));
    await mountSkill();
    pin();
  });

  it("after a failed load", async () => {
    api.skillGet.mockRejectedValue(new Error("Gone"));
    api.botsList.mockResolvedValue(SKILL_BOTS);
    await mountSkill();
    await screen.findByText("Couldn't load skill");
    pin();
  });

  it("used by one bot, bots still loading", async () => {
    api.skillGet.mockResolvedValue(skill());
    api.botsList.mockReturnValue(new Promise(() => {}));
    await mountSkill();
    pin();
  });

  it("used by one bot", async () => {
    api.skillGet.mockResolvedValue(skill());
    api.botsList.mockResolvedValue(SKILL_BOTS);
    await mountSkill();
    pin();
  });

  it("used by none", async () => {
    api.skillGet.mockResolvedValue(skill({ botIds: [], files: [], body: "" }));
    api.botsList.mockResolvedValue(SKILL_BOTS);
    await mountSkill();
    pin("edit");
    await user.click(screen.getByRole("tab", { name: "Preview" }));
    await hoverShown();
    pin("empty preview");
  });

  it("no bots", async () => {
    api.skillGet.mockResolvedValue(skill({ botIds: [] }));
    api.botsList.mockResolvedValue([]);
    await mountSkill();
    pin();
  });

  it("edited, previewed, then asked to delete", async () => {
    api.skillGet.mockResolvedValue(skill({ botIds: ["b1", "b2"] }));
    api.botsList.mockResolvedValue(SKILL_BOTS);
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
  botIds: ["b1"],
  status: "connected",
  createdAt: new Date(Date.now() - 3 * DAY).toISOString(),
  ...partial,
});

const CONNECTION_BOTS = [
  { id: "b1", name: "Helper Bot", description: "Helps" },
  { id: "b2", name: "Journal Bot", description: "" },
];

function seedBots(bots: unknown[] | null) {
  useBotsStore.setState({
    bots: (bots ?? []) as never,
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
    api.connectionGet.mockReturnValue(new Promise(() => {}));
    await mountConnection();
    pin();
  });

  it("after a failed load", async () => {
    seedBots(CONNECTION_BOTS);
    api.connectionGet.mockRejectedValue(new Error("Gone"));
    await mountConnection();
    await screen.findByText("Couldn't load connection");
    pin();
  });

  it("connected, with tools and bots", async () => {
    seedBots(CONNECTION_BOTS);
    api.connectionGet.mockResolvedValue(connection());
    await mountConnection();
    pin();
  });

  it.each(["connecting", "needs_auth", "error", "connected"] as const)(
    "%s, without tools, bots loading",
    async (status) => {
      seedBots(null);
      api.connectionGet.mockResolvedValue(
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
    api.connectionGet.mockResolvedValue(connection({ botIds: [] }));
    await mountConnection();
    pin();
  });

  it.each([
    ["none", []],
    ["one", ["b1"]],
    ["several", ["b1", "b2"]],
  ])("the remove prompt for %s", async (_name, botIds) => {
    seedBots(CONNECTION_BOTS);
    api.connectionGet.mockResolvedValue(connection({ botIds }));
    await mountConnection();
    await user.click(screen.getByRole("button", { name: "Remove" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Remove connection?")).toBeTruthy();
    pin();
  });
});
