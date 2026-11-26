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
import { db, bots, connections as connectionsTable, skills as skillsTable } from "../../db";
import { takesShared } from "./bot-reach";
import type { BotData } from "../../../shared/api/bots";
import type { BrowserProfile } from "../../../shared/api/live";
import { resolveAttachments } from "../uploads/uploads.attach";
import { sentInBot } from "../uploads/uploads.service";
import { ownerUserId, participantNames } from "../people/people.service";
import { botModelId, botToolkits, connectionCapabilityId, modelSeesImages } from "./bot-toolkits";

export interface BotRow {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  modelId: string | null;
  conversationId: string;
  chatStartedAt: Date;
  lastReadAt: Date | null;
  lastActivityAt: Date;
  lastMessagePreview: string | null;
  toolPermissions: string;
  memoryEnabled: boolean;
  autoReview: boolean;
  yoloByDefault: boolean;
  memoryCapturedThrough: Date | null;
  pinnedAt: Date | null;
  browserProfile: BrowserProfile;
  projectId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type Bot = BotData & Omit<BotRow, "toolPermissions">;

type ConnectionLink = {
  connectionId: string;
  connection: { slug: string; toolsCache: string; disabledTools: string };
};

export function conversationRef(stored: string): ConversationRef {
  return Number(stored);
}

export type BotWithLinks = BotRow & {
  skills?: { skillId: string }[];
  connections?: ConnectionLink[];
  guests?: { userId: number }[];
};

const withLinks = {
  skills: { columns: { skillId: true, enabled: true } },
  connections: {
    columns: { connectionId: true, enabled: true },
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

export async function findBotRow(id: string): Promise<BotWithLinks> {
  const bot = await db.query.bots.findFirst({ where: eq(bots.id, id), with: withLinks });
  if (!bot) throw Boom.notFound("Bot not found");
  const shared = takesShared(bot);
  const linkedConnections = new Set(bot.connections.map((link) => link.connectionId));
  const linkedSkills = new Set(bot.skills.map((link) => link.skillId));
  const sharedConnections = shared
    ? await db.query.connections.findMany({
        where: eq(connectionsTable.allBots, true),
        columns: { id: true, slug: true, toolsCache: true, disabledTools: true },
      })
    : [];
  const sharedSkills = shared
    ? await db.query.skills.findMany({
        where: eq(skillsTable.allBots, true),
        columns: { id: true },
      })
    : [];
  return {
    ...bot,
    connections: [
      ...bot.connections
        .filter((link) => link.enabled)
        .map(({ connectionId, connection }) => ({ connectionId, connection })),
      ...sharedConnections
        .filter((connection) => !linkedConnections.has(connection.id))
        .map(({ id: connectionId, ...connection }) => ({ connectionId, connection })),
    ],
    skills: [
      ...bot.skills.filter((link) => link.enabled).map(({ skillId }) => ({ skillId })),
      ...sharedSkills
        .filter((skill) => !linkedSkills.has(skill.id))
        .map((skill) => ({ skillId: skill.id })),
    ],
  };
}

export type BotConversationRuntime = Pick<
  AgentRuntime,
  "createConversation" | "configure" | "submit" | "catalog" | "setYolo"
>;

export interface BotDraft {
  modelId: string | null;
  projectId?: string | null;
  systemPrompt: string;
  toolPermissions: Record<string, ToolPermission>;
  autoReview?: boolean;
  yoloByDefault?: boolean;
}

export const ROUTINE_RUN_TOKEN_BUDGET = 500_000;

const ROUTINE_RUN_GUIDANCE =
  "This conversation runs one scheduled routine run, and nobody watches it live: you cannot " +
  "ask the owner anything here. It starts fresh each run: earlier runs' conversations are not " +
  "here, only the short results the prompt quotes. Keep the run lean: fetch only what the task " +
  "needs, prefer small, specific tool results, and stop once you have the answer; a run has a " +
  "token budget and is cut off when it spends it. " +
  "Your reply is recorded as the run's result, but nobody is told it: to tell the owner " +
  "something, call message_owner, and send nothing when there is nothing new. " +
  "If a run cannot do its job until the owner fixes something " +
  "(a missing vault login, an account you cannot reach, an approval routines cannot get), " +
  "call report_routine_blocked with what they need to do, then reply in a sentence. If there " +
  "was simply nothing to do this time, just say so; that is not blocked.";

const BOT_MESSAGE_GUIDANCE =
  "This conversation answers one message from another bot, and nobody watches it live: you " +
  "cannot ask the owner anything here. It starts fresh: your chat with the owner is not here, " +
  "so work from what the message says. Your reply is relayed to the bot that wrote, so reply " +
  "with what it needs. Keep it lean: fetch only what the answer needs, and stop once you have " +
  "it; this conversation has a token budget and is cut off when it spends it.";

type Unattended = false | "routine" | "bot-message";

function unattendedGuidance(unattended: Exclude<Unattended, false>): string {
  return unattended === "routine" ? ROUTINE_RUN_GUIDANCE : BOT_MESSAGE_GUIDANCE;
}

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

function agentConfig(
  bot: BotDraft & { connections?: ConnectionLink[] },
  rt: Pick<AgentRuntime, "catalog">,
  unattended: Unattended = false,
  participants: string[] = [],
): BotAgentConfig {
  return {
    modelId: botModelId(rt.catalog, bot.modelId),
    systemPrompt: unattended
      ? [bot.systemPrompt.trim(), unattendedGuidance(unattended)].filter(Boolean).join("\n\n")
      : participants.length > 0
        ? [bot.systemPrompt.trim(), sharedChatGuidance(participants)].filter(Boolean).join("\n\n")
        : bot.systemPrompt,
    capabilities: {
      enabled: botToolkits(
        {
          modelId: bot.modelId,
          projectId: bot.projectId ?? null,
          connections: bot.connections?.map((link) => link.connection),
        },
        rt.catalog,
      ),
      permissions: bot.toolPermissions,
      ...(bot.autoReview ? { autoReview: true } : {}),
      ...(unattended ? { unattended: true, budgetTokens: ROUTINE_RUN_TOKEN_BUDGET } : {}),
    },
  };
}

async function rowConfig(
  row: BotWithLinks,
  rt: Pick<AgentRuntime, "catalog">,
  unattended: Unattended = false,
): Promise<BotAgentConfig> {
  const participants =
    !unattended && (row.guests?.length ?? 0) > 0 ? await participantNames(row.id) : [];
  return agentConfig({ ...toBot(row), connections: row.connections }, rt, unattended, participants);
}

export async function startBotConversation(
  bot: string | BotDraft,
  rt: BotConversationRuntime,
  options: { unattended?: Unattended } = {},
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

export async function reconcileBotConversation(
  id: string,
  rt: Pick<BotConversationRuntime, "configure" | "catalog">,
): Promise<Bot> {
  const row = await findBotRow(id);
  await rt.configure(conversationRef(row.conversationId), await rowConfig(row, rt));
  return toBot(row);
}

export interface BotSubmission {
  requestId: string;
  text: string;
  attachments?: string[];
  peer?: ChatMessage["peer"];
  author?: ChatMessage["author"];
  whenBusy?: "steer" | "followUp";
}

export interface SubmitTarget {
  unattendedConversationId: string;
  unattended: Exclude<Unattended, false>;
}

export async function submitToBot(
  id: string,
  submission: BotSubmission,
  rt: BotConversationRuntime,
  target?: SubmitTarget,
): Promise<{ bot: Bot; attachments?: AttachmentRef[] }> {
  const row = await findBotRow(id);
  const resolved = await resolveAttachments(submission, modelSeesImages(rt.catalog, row.modelId));
  await sentInBot(submission.attachments ?? [], row.id);
  const conversation = conversationRef(target?.unattendedConversationId ?? row.conversationId);
  await rt.configure(conversation, await rowConfig(row, rt, target?.unattended ?? false));
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
