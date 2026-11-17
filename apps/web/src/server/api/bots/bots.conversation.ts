/**
 * A bot's durable conversations, kept in step with its row.
 *
 * The `Bot` row (app.db) is the source of truth for persona, model, tool
 * permissions and links; each durable conversation (agent.db) runs with the
 * config of its last configure. A bot has its chat and one conversation per
 * routine (issue #63), which runs unattended: nobody is there to approve. Every path that puts a message in front of a
 * bot (owner sends, mentions, relayed replies, bot-to-bot messages, routine
 * fires) must reconcile first, or drift (a model that gained vision, a
 * toolkit edited in the row, a connection added) silently strands old
 * selections. This module is the one place that does it: callers name the
 * bot and what to deliver, never the config.
 */
import { eq } from "drizzle-orm";
import { Boom } from "@groot/core/errors";
import {
  SKIP_REPLY,
  type AgentRuntime,
  type AttachmentRef,
  type BotAgentConfig,
  type ChatMessage,
  type ConversationRef,
  type ToolPermission,
} from "@tiny-agents/agent";
import { db, bots } from "../../db";
import type { BotData } from "../../../shared/api/bots";
import type { BrowserProfile } from "../../../shared/api/live";
import { resolveAttachments } from "../uploads/uploads.attach";
import { sentInBot } from "../uploads/uploads.service";
import { ownerUserId, participantNames } from "../people/people.service";
import { botModelId, botToolkits, connectionCapabilityId, modelSeesImages } from "./bot-toolkits";

/** The `bots` row as the database returns it (table defined in apps/web/src/server/db/schema.ts). */
export interface BotRow {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  /** Null: the bot runs on the `bot_default` model role. */
  modelId: string | null;
  conversationId: string;
  /** When the current chat conversation started; routine cards older than it stay out. */
  chatStartedAt: Date;
  lastReadAt: Date | null;
  lastActivityAt: Date;
  lastMessagePreview: string | null;
  /** JSON object: tool name → permission. */
  toolPermissions: string;
  /** Memory capture + injection switch (issue #22). */
  memoryEnabled: boolean;
  /** Auto-review switch (issue #65). */
  autoReview: boolean;
  /** Every new chat starts with YOLO mode on (issue #151). */
  yoloByDefault: boolean;
  /** Transcript watermark: owner turns captured through this instant. */
  memoryCapturedThrough: Date | null;
  /** Set while the bot is pinned to the top of the sidebar. */
  pinnedAt: Date | null;
  /** "shared" (the default browser profile) or "own". */
  browserProfile: BrowserProfile;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * The bot as the API returns it: capability columns parsed, skills and
 * connections by id. The wire type (`shared/api/bots.ts`), which must stay
 * the row plus those fields.
 */
export type Bot = BotData & Omit<BotRow, "toolPermissions">;

type ConnectionLink = {
  connectionId: string;
  connection: { slug: string; toolsCache: string; disabledTools: string };
};

/**
 * A durable conversation as the runtime addresses it. Rows store it as text
 * (`bots.conversationId`, `routines.conversationId`, `bot_chats`); this is
 * the one place that turns a stored id into a ref, and `startBotConversation`
 * the one that stores a new ref.
 */
export function conversationRef(stored: string): ConversationRef {
  return Number(stored);
}

export type BotWithLinks = BotRow & {
  skills?: { skillId: string }[];
  connections?: ConnectionLink[];
  guests?: { userId: number }[];
};

const withLinks = {
  skills: { columns: { skillId: true } },
  connections: {
    columns: { connectionId: true },
    with: {
      connection: { columns: { slug: true, toolsCache: true, disabledTools: true } },
    },
  },
  guests: { columns: { userId: true } },
} as const;

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function toBot(row: BotWithLinks): Bot {
  const { skills, connections, guests, ...bot } = row;
  return {
    ...bot,
    toolPermissions: parseJson<Record<string, ToolPermission>>(row.toolPermissions, {}),
    skillIds: skills?.map((link) => link.skillId) ?? [],
    connectionIds: connections?.map((link) => link.connectionId) ?? [],
    connectionCapabilities:
      connections?.map((link) => connectionCapabilityId(link.connection.slug)) ?? [],
    guestIds: guests?.map((link) => link.userId) ?? [],
  };
}

/** A bot's row with its links, or 404. */
export async function findBotRow(id: string): Promise<BotWithLinks> {
  const bot = await db.query.bots.findFirst({ where: eq(bots.id, id), with: withLinks });
  if (!bot) throw Boom.notFound("Bot not found");
  return bot;
}

/** What the conversation module needs from the runtime. */
export type BotConversationRuntime = Pick<
  AgentRuntime,
  "createConversation" | "configure" | "submit" | "catalog" | "setYolo"
>;

/** A bot that does not exist yet: the fields its first conversation is created from. */
export interface BotDraft {
  modelId: string | null;
  systemPrompt: string;
  toolPermissions: Record<string, ToolPermission>;
  autoReview?: boolean;
  /** The new chat starts with YOLO mode on. */
  yoloByDefault?: boolean;
}

/**
 * Added to a routine run's persona (issue #87): nobody watches a routine
 * run, so a run that cannot do its job must say so through the tool that
 * records it, or it reads as succeeded. It also says the run starts fresh
 * and has a budget, so the model works lean.
 */
/**
 * Tokens one routine run may use (every model request and tool spend of its
 * conversation, cache reads included). Each run starts a fresh conversation,
 * so this bounds what one run costs: past it, tool calls are refused so the
 * model answers with what it has, and at 1.5x the run is stopped.
 */
export const ROUTINE_RUN_TOKEN_BUDGET = 500_000;

const ROUTINE_RUN_GUIDANCE =
  "This conversation runs one scheduled routine run, and nobody watches it live: you cannot " +
  "ask the owner anything here. It starts fresh each run: earlier runs' conversations are not " +
  "here, only the short results the prompt quotes. Keep the run lean: fetch only what the task " +
  "needs, prefer small, specific tool results, and stop once you have the answer; a run has a " +
  "token budget and is cut off when it spends it. " +
  "If a run cannot do its job until the owner fixes something " +
  "(a missing vault login, an account you cannot reach, an approval routines cannot get), " +
  "call report_routine_blocked with what they need to do, then reply in a sentence. If there " +
  "was simply nothing to do this time, just say so; that is not blocked.";

/**
 * Added to a shared bot's chat (issue #145): several people write in it, each
 * message prefixed with its sender's name, and the bot stays quiet when they
 * are only talking to each other.
 */
export function sharedChatGuidance(names: string[]): string {
  const people =
    names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names.join("");
  return (
    `This chat is shared by ${people}. Each message starts with its sender's name ` +
    `("Name: message"); keep track of who asked for what, and address people by name ` +
    `when it helps. Reply when someone talks to you, asks for something, or @mentions you. ` +
    `If people are only talking to each other, reply with exactly ${SKIP_REPLY} and nothing else.`
  );
}

/**
 * What the bot's durable conversation runs with: persona, model and
 * capabilities (which ones is `botToolkits`'s decision, bot-toolkits.ts).
 * `unattended` (a routine's conversation): calls that would ask are refused.
 */
function agentConfig(
  bot: BotDraft & { connections?: ConnectionLink[] },
  rt: Pick<AgentRuntime, "catalog">,
  unattended = false,
  /** Everyone in a shared chat (issue #145); empty when it is not shared. */
  participants: string[] = [],
): BotAgentConfig {
  return {
    modelId: botModelId(rt.catalog, bot.modelId),
    systemPrompt: unattended
      ? [bot.systemPrompt.trim(), ROUTINE_RUN_GUIDANCE].filter(Boolean).join("\n\n")
      : participants.length > 0
        ? [bot.systemPrompt.trim(), sharedChatGuidance(participants)].filter(Boolean).join("\n\n")
        : bot.systemPrompt,
    capabilities: {
      enabled: botToolkits(
        { modelId: bot.modelId, connections: bot.connections?.map((link) => link.connection) },
        rt.catalog,
      ),
      permissions: bot.toolPermissions,
      ...(bot.autoReview ? { autoReview: true } : {}),
      ...(unattended ? { unattended: true, budgetTokens: ROUTINE_RUN_TOKEN_BUDGET } : {}),
    },
  };
}

/** Config from a bot row; a shared bot's chat (not its routines) also names its people. */
async function rowConfig(
  row: BotWithLinks,
  rt: Pick<AgentRuntime, "catalog">,
  unattended = false,
): Promise<BotAgentConfig> {
  const participants =
    !unattended && (row.guests?.length ?? 0) > 0 ? await participantNames(row.id) : [];
  return agentConfig({ ...toBot(row), connections: row.connections }, rt, unattended, participants);
}

/**
 * Open a fresh durable conversation for a new bot (from its draft) or an
 * existing one (by id, from its row). Returns the id to store on the row.
 * `unattended`: a routine's conversation (issue #63) rather than a chat.
 * A chat of a bot with `yoloByDefault` starts with YOLO mode on, trusting
 * the owner's messages; a routine's conversation never does.
 */
export async function startBotConversation(
  bot: string | BotDraft,
  rt: BotConversationRuntime,
  options: { unattended?: boolean } = {},
): Promise<string> {
  const unattended = options.unattended ?? false;
  const row = typeof bot === "string" ? await findBotRow(bot) : undefined;
  const config = row
    ? await rowConfig(row, rt, unattended)
    : agentConfig(bot as BotDraft, rt, unattended);
  const ref = await rt.createConversation(config);
  const yolo = (row ?? (bot as BotDraft)).yoloByDefault === true;
  if (yolo && !unattended) await rt.setYolo(ref, true, await ownerUserId());
  return String(ref);
}

/** Re-apply a bot's stored configuration to its conversation (after row or link changes). */
export async function reconcileBotConversation(
  id: string,
  rt: Pick<BotConversationRuntime, "configure" | "catalog">,
): Promise<Bot> {
  const row = await findBotRow(id);
  await rt.configure(conversationRef(row.conversationId), await rowConfig(row, rt));
  return toBot(row);
}

/** One message for a bot's conversation. */
export interface BotSubmission {
  /** Idempotency key: retrying the same id never submits twice. */
  requestId: string;
  text: string;
  /** Upload ids (issue #17); unknown ids reject before anything durable happens. */
  attachments?: string[];
  /** Trusted attribution for a cross-bot delivery (rendered as a card). */
  peer?: ChatMessage["peer"];
  /** Who sent it, in a shared chat; `text` is already prefixed with their name. */
  author?: ChatMessage["author"];
  /** Placement while a reply runs: "steer" joins it, "followUp" (default) waits. */
  whenBusy?: "steer" | "followUp";
}

/**
 * Where a submission goes: the bot's chat (the default) or one of its
 * routines' conversations, which run unattended (issue #63).
 */
export interface SubmitTarget {
  routineConversationId: string;
}

/**
 * Deliver a message to a bot: resolve its attachments for the bot's model,
 * reconcile the target conversation with the row, then submit. Throws 404
 * for an unknown bot and rejects bad attachments before anything durable
 * happens. Returns the bot and the attachment refs stored on the entry.
 */
export async function submitToBot(
  id: string,
  submission: BotSubmission,
  rt: BotConversationRuntime,
  target?: SubmitTarget,
): Promise<{ bot: Bot; attachments?: AttachmentRef[] }> {
  const row = await findBotRow(id);
  const resolved = await resolveAttachments(submission, modelSeesImages(rt.catalog, row.modelId));
  await sentInBot(submission.attachments ?? [], row.id);
  const conversation = conversationRef(target?.routineConversationId ?? row.conversationId);
  await rt.configure(conversation, await rowConfig(row, rt, target !== undefined));
  await rt.submit(conversation, {
    requestId: submission.requestId,
    text: resolved.text,
    ...(resolved.images ? { images: resolved.images } : {}),
    ...(resolved.attachments ? { attachments: resolved.attachments } : {}),
    ...(submission.peer ? { peer: submission.peer } : {}),
    ...(submission.author ? { author: submission.author } : {}),
    ...(submission.whenBusy ? { whenBusy: submission.whenBusy } : {}),
  });
  return {
    bot: toBot(row),
    ...(resolved.attachments ? { attachments: resolved.attachments } : {}),
  };
}
