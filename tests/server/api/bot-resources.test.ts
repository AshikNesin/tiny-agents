/**
 * BOT_RESOURCES (bot-resources.ts) is the one list of what a bot owns. These
 * tests fail when something holding bot ids is missing from it (a schema
 * column, a `…ForBot` key function), and delete a bot that owns one of
 * every released and retained kind through the real route to see each go,
 * or stay, as its entry says.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, getTableName, is, sql } from "drizzle-orm";
import { getTableConfig, SQLiteTable, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { logger } from "@groot/core/logger";
import * as schema from "../../../apps/web/src/server/db";
import {
  db,
  jobs,
  notificationLog,
  vaultAuditEvents,
  vaultItems,
} from "../../../apps/web/src/server/db";
import {
  BOT_RESOURCES,
  settleBotReleases,
} from "../../../apps/web/src/server/api/bots/bot-resources";
import { conversationRef } from "../../../apps/web/src/server/api/bots/bots.conversation";
import {
  onBotChatEvent,
  publishBotChatEvent,
} from "../../../apps/web/src/server/api/bots/bots.events";
import { setBrowserSessionsForTests } from "../../../apps/web/src/server/api/bots/browser.sessions";
import { setComputerSessionsForTests } from "../../../apps/web/src/server/api/bots/computer.sessions";
import {
  claimConversation,
  createRoutine,
} from "../../../apps/web/src/server/api/routines/routines.arming";
import {
  createBrowserSessions,
  type BrowserSession,
  type BrowserSessions,
  type BrowserTransport,
} from "../../../packages/agent/src/toolkits/browser";
import {
  createComputerSessions,
  type ComputerSessions,
} from "../../../packages/agent/src/toolkits/computer";
import type { AgentRuntime } from "../../../packages/agent/src/index";
import { fakeComputer, type FakeComputer } from "../app/agent/computer-fakes";
import { api, createTestApp } from "../helpers";
import {
  authToken,
  closeAppRuntime,
  openAppRuntime,
  resetAppTables,
  seedBot,
  spyOnRuntime,
  type SeededBot,
  type SpiedRuntime,
} from "../fixtures";

const RESOURCES = "BOT_RESOURCES (apps/web/src/server/api/bots/bot-resources.ts)";
const BOT_ID_COLUMN = /(^|_)bots?_(id|json)$/;

type Kind = keyof typeof BOT_RESOURCES;
type Entry = (typeof BOT_RESOURCES)[Kind];
const entries = Object.entries(BOT_RESOURCES) as [Kind, Entry][];

const tables = Object.values(schema as Record<string, unknown>).filter(
  (value): value is SQLiteTable => is(value, SQLiteTable),
);

const columnName = (column: AnySQLiteColumn) => `${getTableName(column.table)}.${column.name}`;

function botIdColumns(): string[] {
  return tables.flatMap((table) => {
    const config = getTableConfig(table);
    const toBots = new Set(
      config.foreignKeys.flatMap((foreignKey) => {
        const reference = foreignKey.reference();
        return getTableName(reference.foreignTable) === "bots"
          ? reference.columns.map((column) => column.name)
          : [];
      }),
    );
    return config.columns
      .filter((column) => toBots.has(column.name) || BOT_ID_COLUMN.test(column.name))
      .map((column) => `${config.name}.${column.name}`);
  });
}

function forBotFunctions(dir = "apps/web/src/server"): { name: string; file: string }[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return forBotFunctions(path);
    if (!path.endsWith(".ts")) return [];
    const source = readFileSync(path, "utf8");
    return [
      ...source.matchAll(/export\s+(?:async\s+)?(?:function\s*\*?|const)\s+(\w+ForBot)\b/g),
    ].map((match) => ({ name: match[1]!, file: path }));
  });
}

describe(RESOURCES, () => {
  it("claims every column holding bot ids exactly once", () => {
    const claims = new Map<string, Kind[]>();
    for (const [kind, entry] of entries) {
      for (const column of entry.columns ?? []) {
        claims.set(columnName(column), [...(claims.get(columnName(column)) ?? []), kind]);
      }
    }
    const problems = botIdColumns().flatMap((column) => {
      const owners = claims.get(column) ?? [];
      if (owners.length === 1) return [];
      return owners.length === 0
        ? [
            `${column} holds bot ids, but no entry in ${RESOURCES} claims it. Add it to the entry that releases it, the cascade entry, or a retained entry saying why it stays.`,
          ]
        : [`${column} is claimed by ${owners.join(" and ")} in ${RESOURCES}. One entry each.`];
    });
    expect(problems).toEqual([]);
  });

  it("claims as cascade only columns whose foreign key deletes them with the bot", () => {
    const problems = entries.flatMap(([kind, entry]) =>
      entry.how !== "cascade"
        ? []
        : entry.columns.flatMap((column) => {
            const cascades = getTableConfig(column.table as SQLiteTable).foreignKeys.some(
              (foreignKey) => {
                const reference = foreignKey.reference();
                return (
                  foreignKey.onDelete === "cascade" &&
                  getTableName(reference.foreignTable) === "bots" &&
                  reference.columns.some((local) => local.name === column.name)
                );
              },
            );
            return cascades
              ? []
              : [
                  `${columnName(column)} is in ${RESOURCES} entry ${kind} (cascade), but no foreign key to bots.id deletes it with the bot. Release it instead.`,
                ];
          }),
    );
    expect(problems).toEqual([]);
  });

  it("names every exported …ForBot key function in some entry's keyedBy", () => {
    const keyed = new Set(
      entries.flatMap(([, entry]) =>
        entry.how === "release" && entry.keyedBy ? [entry.keyedBy.name] : [],
      ),
    );
    const problems = forBotFunctions()
      .filter(({ name }) => !keyed.has(name))
      .map(
        ({ name, file }) =>
          `${name} (${file}) names something a bot owns, but no entry in ${RESOURCES} has keyedBy: ${name}. Add a release entry for it.`,
      );
    expect(problems).toEqual([]);
  });
});

const token = await authToken("bot-resources-test@example.com");
const app = createTestApp();
const deleteBot = (id: string) => api(app, `/api/v1/bots/${id}`, { method: "DELETE", token });

function fakeBrowser() {
  const closed: string[] = [];
  let tabs = 0;
  const tab = (name: string): BrowserSession => ({
    url: () => "about:blank",
    navigate: async (url) => ({ url, status: 200 }),
    snapshot: async () => "",
    click: async () => ({ url: "about:blank" }),
    type: async () => ({ url: "about:blank" }),
    press: async () => {},
    scroll: async () => {},
    screenshot: async () => ({ data: "" }),
    close: async () => {
      closed.push(name);
    },
    openTab: async () => tab(`tab-${++tabs}`),
  });
  const transport: BrowserTransport = async (dir) => tab(dir);
  return { transport, closed };
}

interface World {
  bot: SeededBot;
  other: SeededBot;
  rt: AgentRuntime;
  spied: SpiedRuntime;
  browser: BrowserSessions;
  closedTabs: string[];
  profilesDir: string;
  computer: ComputerSessions;
  desktops: FakeComputer;
}

type Check = () => Promise<void>;

type SeededKind = {
  [K in Kind]: (typeof BOT_RESOURCES)[K]["how"] extends "cascade" ? never : K;
}[Kind];

const seeds: Record<SeededKind, (world: World) => Promise<Check>> = {
  async chat({ bot, spied }) {
    return async () => {
      expect(spied.abort).toHaveBeenCalledWith(conversationRef(bot.conversationId));
    };
  },
  async routines({ bot, rt, spied }) {
    const { id } = await createRoutine(
      {
        botId: bot.id,
        name: "digest",
        prompt: "Summarize.",
        schedule: { kind: "interval", minutes: 60 },
      },
      true,
    );
    const conversation = String(
      await rt.createConversation({ modelId: bot.modelId, systemPrompt: "" }),
    );
    await claimConversation(id, conversation);
    const routine = await db.query.routines.findFirst({ where: eq(schema.routines.id, id) });
    return async () => {
      const [job] = await db.select().from(jobs).where(eq(jobs.id, routine!.pendingJobId!));
      expect(job?.state).toBe("cancelled");
      expect(spied.abort).toHaveBeenCalledWith(conversationRef(conversation));
    };
  },
  async browser({ bot, other, browser, closedTabs, profilesDir }) {
    const own = { profile: `bot-${bot.id}`, tab: bot.id };
    await browser.acquire(own);
    await browser.close(own);
    await browser.acquire({ profile: "shared", tab: other.id });
    await browser.acquire({ profile: "shared", tab: bot.id });
    return async () => {
      expect(closedTabs).toContain("tab-1");
      expect(browser.peek({ profile: "shared", tab: bot.id })).toBeUndefined();
      expect(browser.peek({ profile: "shared", tab: other.id })).toBeDefined();
      expect(existsSync(join(profilesDir, own.profile))).toBe(false);
    };
  },
  async desktop({ bot, computer, desktops }) {
    await computer.acquire(`bot-${bot.id}`);
    await computer.acquire("shared");
    return async () => {
      expect(desktops.wiped).toContain(`bot-${bot.id}`);
      expect(computer.get(`bot-${bot.id}`)).toBeUndefined();
      expect(computer.get("shared")).toBeDefined();
      expect(desktops.wiped).not.toContain("shared");
    };
  },
  async vaultGrants({ bot, other }) {
    const item = (handle: string, bots: string[]) => ({
      handle,
      kind: "api_key",
      backend: "local",
      externalId: handle,
      label: handle,
      botsJson: JSON.stringify(bots),
    });
    await db
      .insert(vaultItems)
      .values([
        item("both", [bot.id, other.id]),
        item("only", [bot.id]),
        { ...item("broken", []), botsJson: "not json" },
      ]);
    return async () => {
      const grants = await db
        .select({ handle: vaultItems.handle, bots: vaultItems.botsJson })
        .from(vaultItems);
      expect(Object.fromEntries(grants.map((row) => [row.handle, row.bots]))).toEqual({
        both: JSON.stringify([other.id]),
        only: "[]",
        broken: "not json",
      });
    };
  },
  async vaultAudit({ bot }) {
    await db
      .insert(vaultAuditEvents)
      .values({ handle: "gone", botId: bot.id, tool: "vault_use", target: "x", outcome: "used" });
    return async () => {
      expect(
        await db.select().from(vaultAuditEvents).where(eq(vaultAuditEvents.botId, bot.id)),
      ).toHaveLength(1);
    };
  },
  async notificationLog({ bot }) {
    await db.insert(notificationLog).values({
      event: "approval.requested",
      category: "needs_input",
      channel: "pushover",
      dedupeKey: `approval:${bot.id}`,
      botId: bot.id,
      title: "Approve?",
      priority: 0,
      status: "sent",
    });
    return async () => {
      const kept = await db.select().from(notificationLog).where(eq(notificationLog.botId, bot.id));
      expect(kept).toHaveLength(1);
    };
  },
  async history({ bot, rt }) {
    const ref = conversationRef(bot.conversationId);
    await rt.submit(ref, { requestId: "remember", text: "Remember this." });
    const said = async () =>
      (await rt.readChat(ref)).messages.some(
        (message) => message.role === "user" && message.text === "Remember this.",
      );
    await vi.waitFor(async () => expect(await said()).toBe(true));
    return async () => {
      expect(await said()).toBe(true);
    };
  },
  async chatStreams({ bot }) {
    const heard: unknown[] = [];
    const stop = onBotChatEvent(bot.id, (event) => heard.push(event));
    return async () => {
      publishBotChatEvent(bot.id, { type: "yolo", on: true });
      expect(heard).toEqual([{ type: "yolo", on: true }]);
      stop();
    };
  },
};

async function holds(column: AnySQLiteColumn, botId: string): Promise<boolean> {
  const where = column.name.endsWith("_json")
    ? sql`json_valid(${column}) and exists (select 1 from json_each(${column}) where value = ${botId})`
    : sql`${column} = ${botId}`;
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(column.table as SQLiteTable)
    .where(where);
  return row!.count > 0;
}

describe("deleting a bot", () => {
  let world: World;

  beforeEach(async () => {
    await resetAppTables();
    const rt = await openAppRuntime();
    const spied = spyOnRuntime(rt);
    const fake = fakeBrowser();
    const profilesDir = mkdtempSync(join(tmpdir(), "ta-bot-resources-"));
    const browser = createBrowserSessions({ profilesDir, transport: fake.transport });
    setBrowserSessionsForTests(browser);
    const desktops = fakeComputer();
    const computer = createComputerSessions({
      transport: desktops.transport,
      width: 1280,
      height: 800,
    });
    setComputerSessionsForTests(computer);
    world = {
      bot: await seedBot({ browserProfile: "own" }),
      other: await seedBot(),
      rt,
      spied,
      browser,
      closedTabs: fake.closed,
      profilesDir,
      computer,
      desktops,
    };
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await world.browser.closeAll();
    await world.computer.closeAll();
    setBrowserSessionsForTests(undefined);
    setComputerSessionsForTests(undefined);
    rmSync(world.profilesDir, { recursive: true, force: true });
    await closeAppRuntime();
    await resetAppTables();
  });

  async function seedThenSwitchToShared(): Promise<Map<SeededKind, Check>> {
    const checks = new Map<SeededKind, Check>();
    for (const kind of Object.keys(seeds) as SeededKind[]) {
      checks.set(kind, await seeds[kind](world));
    }
    const switched = await api(app, `/api/v1/bots/${world.bot.id}`, {
      method: "PATCH",
      json: { browserProfile: "shared" },
      token,
    });
    expect(switched.status).toBe(200);
    return checks;
  }

  // tests/ is outside every typecheck program, so the Record type alone would not fail CI.
  it("has a seed for every released and retained kind", () => {
    const missing = entries
      .filter(([kind, entry]) => entry.how !== "cascade" && !(kind in seeds))
      .map(
        ([kind]) =>
          `${RESOURCES} entry ${kind} has no seed in tests/server/api/bot-resources.test.ts. Add one that gives the bot one and checks it went, or stayed.`,
      );
    expect(missing).toEqual([]);
  });

  it("releases every released kind, keeps every retained one, and leaves no claimed bot id", async () => {
    const checks = await seedThenSwitchToShared();
    const claimed = entries.flatMap(([, entry]) =>
      (entry.columns ?? []).map((column) => ({ column, how: entry.how })),
    );
    for (const { column, how } of claimed) {
      if (how !== "cascade")
        expect(await holds(column, world.bot.id), columnName(column)).toBe(true);
    }

    expect((await deleteBot(world.bot.id)).status).toBe(200);
    await settleBotReleases();

    for (const { column, how } of claimed) {
      expect(await holds(column, world.bot.id), columnName(column)).toBe(how === "retained");
    }
    for (const check of checks.values()) await check();
  });

  it("logs a failing release with its kind, runs the others, and still deletes", async () => {
    const warn = vi.spyOn(logger, "warn");
    const checks = await seedThenSwitchToShared();
    vi.spyOn(world.browser, "closeTab").mockRejectedValue(new Error("browser gone"));

    expect((await deleteBot(world.bot.id)).status).toBe(200);
    await settleBotReleases();

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ botId: world.bot.id, resource: "browser" }),
      "Failed to release a deleted bot's resource",
    );
    for (const [kind, check] of checks) if (kind !== "browser") await check();
  });

  it("answers before the releases that wait on the sandbox VM finish", async () => {
    let finish!: () => void;
    const hung = new Promise<void>((resolve) => (finish = resolve));
    vi.spyOn(world.browser, "close").mockReturnValue(hung);
    vi.spyOn(world.computer, "close").mockReturnValue(hung);

    expect((await deleteBot(world.bot.id)).status).toBe(200);

    expect(world.spied.abort).toHaveBeenCalledWith(conversationRef(world.bot.conversationId));
    let settled = false;
    const settling = settleBotReleases().then(() => (settled = true));
    for (let tick = 0; tick < 20; tick++) await Promise.resolve();
    expect(settled).toBe(false);
    finish();
    await settling;
  });

  it("answers 404 for a bot already deleted and releases nothing again", async () => {
    expect((await deleteBot(world.bot.id)).status).toBe(200);
    await settleBotReleases();
    vi.clearAllMocks();
    const closeTab = vi.spyOn(world.browser, "closeTab");
    const closeDesktop = vi.spyOn(world.computer, "close");

    expect((await deleteBot(world.bot.id)).status).toBe(404);

    expect(world.spied.abort).not.toHaveBeenCalled();
    expect(closeTab).not.toHaveBeenCalled();
    expect(closeDesktop).not.toHaveBeenCalled();
  });
});
