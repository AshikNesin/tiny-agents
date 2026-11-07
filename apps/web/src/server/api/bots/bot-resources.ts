/**
 * Something new a bot owns gets an entry in BOT_RESOURCES:
 * tests/server/api/bot-resources.test.ts fails for a column holding bot ids
 * or an exported `…ForBot` function that no entry claims. `capture` runs
 * before the bot row is deleted because the cascade erases what it reads.
 *
 * Every `release` must be safe to run twice: one cut off by a crash or failed
 * by a sandbox outage runs again at the next boot (`sweepBotReleases`). What
 * `capture` read is stored as JSON and parsed by `capture.shape` when the
 * release runs, possibly by a later build; a record that no longer parses
 * is dropped.
 */
import { and, eq } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { Boom } from "@groot/core/errors";
import { logger } from "@groot/core/logger";
import type { AgentRuntime } from "@tiny-agents/agent";
import { z } from "zod";
import {
  db,
  botChats,
  botConnections,
  botGuests,
  botMessages,
  botReleases,
  bots,
  botSkills,
  codeHandoffs,
  memories,
  notificationLog,
  promptRevisions,
  routines,
  shelleyHandoffs,
  uploads,
  vaultAuditEvents,
  vaultItems,
} from "../../db";
import { revokeLiveAccess } from "../people/live-access";
import { cancelFireJob } from "../routines/routines.arming";
import { forgetBotInVault } from "../vault/vault.admin.service";
import { findBotRow, type BotRow } from "./bots.conversation";
import { getBrowserSessions } from "./browser.sessions";
import { browserTargetForBot, ownBrowserProfile, SHARED_BROWSER_PROFILE } from "./browser.targets";
import { retireConversation } from "./chats.history";
import { computerProfileForBot, computerSetupHint, getComputerSessions } from "./computer.sessions";
import { sandboxEndpoint } from "./sandbox-host";

interface ReleaseContext {
  rt: Pick<AgentRuntime, "abort">;
}

type Columns = readonly AnySQLiteColumn[];

interface Cascade {
  how: "cascade";
  columns: Columns;
}

interface Retained {
  how: "retained";
  reason: string;
  columns?: Columns;
}

type Release = (context: ReleaseContext) => Promise<void>;

interface Released {
  how: "release";
  columns?: Columns;
  keyedBy?: (...args: never[]) => unknown;
  /** Waits on the sandbox VM, so the delete answers without it. */
  background?: true;
  /** What the release needs, as stored JSON. */
  capture(bot: BotRow): Promise<string>;
  /** Throws when `stored` no longer fits the entry's shape. */
  prepare(botId: string, stored: string): Release;
}

type BotResource = Cascade | Retained | Released;

function cascade(...columns: AnySQLiteColumn[]): Cascade {
  return { how: "cascade", columns };
}

function retained(reason: string, columns?: Columns): Retained {
  return { how: "retained", reason, columns };
}

interface Capture<Captured> {
  shape: z.ZodType<Captured>;
  read(bot: BotRow): Captured | Promise<Captured>;
}

const NOTHING: Capture<null> = { shape: z.null(), read: () => null };

function released<Captured>(entry: {
  columns?: Columns;
  keyedBy?: Released["keyedBy"];
  background?: true;
  capture: Capture<Captured>;
  release: (botId: string, captured: Captured, context: ReleaseContext) => Promise<void>;
}): Released {
  const { capture, release, ...claims } = entry;
  return {
    how: "release",
    ...claims,
    capture: async (bot) => JSON.stringify(await capture.read(bot)),
    prepare(botId, stored) {
      const captured = capture.shape.parse(JSON.parse(stored));
      return (context) => release(botId, captured, context);
    },
  };
}

export const BOT_RESOURCES = {
  rows: cascade(
    botChats.botId,
    botMessages.fromBotId,
    botMessages.toBotId,
    botMessages.replyToBotId,
    shelleyHandoffs.botId,
    codeHandoffs.botId,
    botSkills.botId,
    botConnections.botId,
    memories.botId,
    promptRevisions.botId,
    botGuests.botId,
  ),
  chat: released({
    capture: { shape: z.string(), read: (bot) => bot.conversationId },
    release: (_botId, conversationId, { rt }) => retireConversation(rt, conversationId),
  }),
  routines: released({
    columns: [routines.botId],
    capture: {
      shape: z.array(
        z.object({ pendingJobId: z.string().nullable(), conversationId: z.string().nullable() }),
      ),
      read: (bot) =>
        db
          .select({ pendingJobId: routines.pendingJobId, conversationId: routines.conversationId })
          .from(routines)
          .where(eq(routines.botId, bot.id)),
    },
    release: async (_botId, owned, { rt }) => {
      await Promise.all(
        owned.map(async ({ pendingJobId, conversationId }) => {
          await cancelFireJob(pendingJobId);
          if (conversationId) await retireConversation(rt, conversationId);
        }),
      );
    },
  }),
  // By bot id, not browserProfile: a bot switched to the shared browser left its own behind.
  browser: released({
    keyedBy: browserTargetForBot,
    background: true,
    capture: NOTHING,
    release: async (botId) => {
      const sessions = getBrowserSessions();
      await Promise.all([
        sessions.closeTab({ profile: SHARED_BROWSER_PROFILE, tab: botId }),
        sessions.close({ profile: ownBrowserProfile(botId), tab: botId }, { wipeProfile: true }),
      ]);
    },
  }),
  desktop: released({
    keyedBy: computerProfileForBot,
    background: true,
    capture: NOTHING,
    release: async (botId) => {
      const computer = getComputerSessions();
      if (computer) return computer.close(ownBrowserProfile(botId), { wipe: true });
      // No SANDBOX_HOST means no VM, so no desktop. A wrong desktop config keeps the row until it is fixed.
      if (sandboxEndpoint()) throw new Error(`Desktop not wiped: ${computerSetupHint()}`);
    },
  }),
  vaultGrants: released({
    columns: [vaultItems.botsJson],
    capture: NOTHING,
    release: (botId) => forgetBotInVault(botId),
  }),
  vaultAudit: retained("the audit log outlives what it audits", [vaultAuditEvents.botId]),
  notificationLog: retained("the record of notifications sent outlives the bot they were about", [
    notificationLog.botId,
  ]),
  history: retained(
    "PRD §5.1: conversation history (the current chat, past chats, routines) and the uploads its messages attach stay in agent.db; Phase 2 adds cleanup",
    [uploads.botId],
  ),
  liveAccess: released({
    capture: NOTHING,
    release: async (botId) => revokeLiveAccess({ botId }),
  }),
} satisfies Record<string, BotResource>;

type Owed = typeof botReleases.$inferSelect;

const backgroundReleases = new Set<Promise<void>>();

/** Resolves once every background release started so far has settled. */
export async function settleBotReleases(): Promise<void> {
  await Promise.all(backgroundReleases);
}

function releasedEntry(resource: string): Released | undefined {
  const entry: BotResource | undefined = (BOT_RESOURCES as Record<string, BotResource>)[resource];
  return entry?.how === "release" ? entry : undefined;
}

function prepare({ botId, resource, captured }: Owed): Release | undefined {
  const entry = releasedEntry(resource);
  if (!entry) {
    logger.warn({ botId, resource }, "Dropping a release owed by a resource kind that is gone");
    return undefined;
  }
  try {
    return entry.prepare(botId, captured);
  } catch (error) {
    logger.warn({ error, botId, resource }, "Dropping an owed release whose record does not parse");
    return undefined;
  }
}

async function runRelease(owed: Owed, rt: ReleaseContext["rt"]): Promise<void> {
  const { botId, resource } = owed;
  try {
    await prepare(owed)?.({ rt });
    await db
      .delete(botReleases)
      .where(and(eq(botReleases.botId, botId), eq(botReleases.resource, resource)));
  } catch (error) {
    logger.warn({ error, botId, resource }, "Failed to release a deleted bot's resource");
  }
}

const isBackground = ({ resource }: Owed) => releasedEntry(resource)?.background === true;

/**
 * The loser of two concurrent deletes gets the 404 and releases nothing.
 * Background releases are still running when this returns.
 */
export async function releaseBot(id: string, rt: ReleaseContext["rt"]): Promise<BotRow> {
  const bot = await findBotRow(id);
  const entries: [string, BotResource][] = Object.entries(BOT_RESOURCES);
  const owed = await Promise.all(
    entries.flatMap(([resource, entry]) =>
      entry.how === "release"
        ? [entry.capture(bot).then((captured) => ({ botId: bot.id, resource, captured }))]
        : [],
    ),
  );
  const { deleted, rows } = db.transaction((tx) => {
    const [deleted] = tx.delete(bots).where(eq(bots.id, bot.id)).returning().all();
    if (!deleted) throw Boom.notFound("Record not found");
    return { deleted, rows: tx.insert(botReleases).values(owed).returning().all() };
  });
  for (const row of rows.filter(isBackground)) {
    const pending = runRelease(row, rt).finally(() => backgroundReleases.delete(pending));
    backgroundReleases.add(pending);
  }
  await Promise.all(rows.filter((row) => !isBackground(row)).map((row) => runRelease(row, rt)));
  return deleted;
}

/**
 * Boot: run again every release a crash or a sandbox outage left owed.
 * Resolves once each has run; what fails again stays for the next boot.
 */
export async function sweepBotReleases(rt: ReleaseContext["rt"]): Promise<void> {
  const owed = await db.select().from(botReleases);
  await Promise.all(owed.map((row) => runRelease(row, rt)));
}
