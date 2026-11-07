/**
 * Something new a bot owns gets an entry in BOT_RESOURCES:
 * tests/server/api/bot-resources.test.ts fails for a column holding bot ids
 * or an exported `…ForBot` function that no entry claims. `capture` runs
 * before the bot row is deleted because the cascade erases what it reads.
 */
import { eq } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { Boom } from "@groot/core/errors";
import { logger } from "@groot/core/logger";
import type { AgentRuntime } from "@tiny-agents/agent";
import {
  db,
  botChats,
  botConnections,
  botGuests,
  botMessages,
  bots,
  botSkills,
  codeHandoffs,
  memories,
  notificationLog,
  promptRevisions,
  routines,
  shelleyHandoffs,
  vaultAuditEvents,
  vaultItems,
} from "../../db";
import { cancelFireJob } from "../routines/routines.arming";
import { forgetBotInVault } from "../vault/vault.admin.service";
import { findBotRow, type BotRow } from "./bots.conversation";
import { getBrowserSessions } from "./browser.sessions";
import { browserTargetForBot, ownBrowserProfile, SHARED_BROWSER_PROFILE } from "./browser.targets";
import { retireConversation } from "./chats.history";
import { computerProfileForBot, getComputerSessions } from "./computer.sessions";

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

interface Released {
  how: "release";
  columns?: Columns;
  keyedBy?: (...args: never[]) => unknown;
  /** Waits on the sandbox VM, so the delete answers without it. */
  background?: true;
  prepare(bot: BotRow): Promise<(context: ReleaseContext) => Promise<void>>;
}

type BotResource = Cascade | Retained | Released;

function cascade(...columns: AnySQLiteColumn[]): Cascade {
  return { how: "cascade", columns };
}

function retained(reason: string, columns?: Columns): Retained {
  return { how: "retained", reason, columns };
}

function released<Captured = undefined>(entry: {
  columns?: Columns;
  keyedBy?: Released["keyedBy"];
  background?: true;
  capture?: (bot: BotRow) => Promise<Captured>;
  release: (bot: BotRow, captured: Captured, context: ReleaseContext) => Promise<void>;
}): Released {
  const { capture, release, ...claims } = entry;
  return {
    how: "release",
    ...claims,
    async prepare(bot) {
      const captured = (await capture?.(bot)) as Captured;
      return (context) => release(bot, captured, context);
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
    release: (bot, _, { rt }) => retireConversation(rt, bot.conversationId),
  }),
  routines: released({
    columns: [routines.botId],
    capture: async (bot) =>
      db
        .select({ pendingJobId: routines.pendingJobId, conversationId: routines.conversationId })
        .from(routines)
        .where(eq(routines.botId, bot.id)),
    release: async (_bot, owned, { rt }) => {
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
    release: async (bot) => {
      const sessions = getBrowserSessions();
      await Promise.all([
        sessions.closeTab({ profile: SHARED_BROWSER_PROFILE, tab: bot.id }),
        sessions.close({ profile: ownBrowserProfile(bot.id), tab: bot.id }, { wipeProfile: true }),
      ]);
    },
  }),
  desktop: released({
    keyedBy: computerProfileForBot,
    background: true,
    release: async (bot) => {
      await getComputerSessions()?.close(ownBrowserProfile(bot.id), { wipe: true });
    },
  }),
  vaultGrants: released({
    columns: [vaultItems.botsJson],
    release: (bot) => forgetBotInVault(bot.id),
  }),
  vaultAudit: retained("the audit log outlives what it audits", [vaultAuditEvents.botId]),
  notificationLog: retained("the record of notifications sent outlives the bot they were about", [
    notificationLog.botId,
  ]),
  history: retained(
    "PRD §5.1: conversation history (the current chat, past chats, routines) and the uploads its messages attach stay in agent.db; Phase 2 adds cleanup",
  ),
  chatStreams: retained(
    "a chat stream open in another tab ends when that tab leaves; ending it here makes the client retry the 404",
  ),
} satisfies Record<string, BotResource>;

const backgroundReleases = new Set<Promise<void>>();

/** Resolves once every background release started so far has settled. */
export async function settleBotReleases(): Promise<void> {
  await Promise.all(backgroundReleases);
}

/**
 * The loser of two concurrent deletes gets the 404 and releases nothing.
 * Background releases are still running when this returns.
 */
export async function releaseBot(id: string, rt: ReleaseContext["rt"]): Promise<BotRow> {
  const bot = await findBotRow(id);
  const entries: [string, BotResource][] = Object.entries(BOT_RESOURCES);
  const releases = await Promise.all(
    entries.flatMap(([resource, entry]) =>
      entry.how === "release"
        ? [
            entry
              .prepare(bot)
              .then((release) => ({ resource, release, background: entry.background === true })),
          ]
        : [],
    ),
  );
  const [deleted] = await db.delete(bots).where(eq(bots.id, bot.id)).returning();
  if (!deleted) throw Boom.notFound("Record not found");
  const run = (resource: string, release: (context: ReleaseContext) => Promise<void>) =>
    release({ rt }).catch((error: unknown) => {
      logger.warn({ error, botId: id, resource }, "Failed to release a deleted bot's resource");
    });
  for (const { resource, release, background } of releases) {
    if (!background) continue;
    const pending = run(resource, release).finally(() => backgroundReleases.delete(pending));
    backgroundReleases.add(pending);
  }
  await Promise.all(
    releases
      .filter(({ background }) => !background)
      .map(({ resource, release }) => run(resource, release)),
  );
  return deleted;
}
