/**
 * Bot CRUD + chat actions over Prisma, backed by the AgentRuntime for every
 * durable-conversation side effect (create/configure/submit/abort/reset).
 */
import { prisma } from "@groot/core/database";
import { Boom } from "@groot/core/errors";
import { logger } from "@groot/core/logger";
import {
  AgentRuntime,
  ApprovalNotPendingError,
  MCP_DEFER_THRESHOLD,
  sanitizePeerText,
  type AttachmentRef,
  type BotAgentConfig,
  type ToolPermission,
} from "@tiny-agents/agent";
import { getAgentRuntime } from "./bots.runtime";
import { modelImage } from "../uploads/uploads.service";

/** Cached vision lookup over the live model catalog (rebuilt per call site). */
function modelSeesImages(modelId: string): boolean {
  try {
    return Boolean(
      getAgentRuntime()
        .listModels()
        .find((m) => m.id === modelId)?.vision,
    );
  } catch {
    return false; // runtime not open (tests without a fake): treat as text-only
  }
}

/** The `Bot` row as Prisma returns it (model defined in apps/web/prisma). */
export interface BotRow {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  modelId: string;
  conversationId: string;
  lastReadAt: Date | null;
  lastActivityAt: Date;
  lastMessagePreview: string | null;
  /** JSON array of enabled toolkit ids. */
  toolkits: string;
  /** JSON object: tool name → permission. */
  toolPermissions: string;
  createdAt: Date;
  updatedAt: Date;
}
import type { CreateBotDTO, UpdateBotDTO } from "./bots.schema";

export type BotAgentRuntime = Pick<
  AgentRuntime,
  | "createConversation"
  | "configure"
  | "submit"
  | "abort"
  | "hasModel"
  | "busyConversations"
  | "listCapabilities"
  | "pendingApprovals"
  | "decideApproval"
>;

/** The bot as the API returns it: capability columns parsed, skills and connections by id. */
export type Bot = Omit<BotRow, "toolkits" | "toolPermissions"> & {
  toolkits: string[];
  toolPermissions: Record<string, ToolPermission>;
  skillIds: string[];
  connectionIds: string[];
  /** Capability ids of the bot's connections (`mcp:<slug>`). */
  connectionCapabilities: string[];
};

type BotWithLinks = BotRow & {
  skills?: { skillId: string }[];
  connections?: { connectionId: string; connection: { slug: string; toolsCache: string } }[];
};

const withLinks = {
  skills: { select: { skillId: true } },
  connections: {
    select: { connectionId: true, connection: { select: { slug: true, toolsCache: true } } },
  },
} as const;

/** Capability id of a connection (`mcp:<slug>`); also its tool-name prefix source. */
export function connectionCapabilityId(slug: string): string {
  return `mcp:${slug}`;
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function toBot(row: BotWithLinks): Bot {
  const { skills, connections, ...bot } = row;
  return {
    ...bot,
    toolkits: parseJson<string[]>(row.toolkits, []),
    toolPermissions: parseJson<Record<string, ToolPermission>>(row.toolPermissions, {}),
    skillIds: skills?.map((link) => link.skillId) ?? [],
    connectionIds: connections?.map((link) => link.connectionId) ?? [],
    connectionCapabilities:
      connections?.map((link) => connectionCapabilityId(link.connection.slug)) ?? [],
  };
}

function toolCount(cache: string): number {
  try {
    return (JSON.parse(cache) as unknown[]).length;
  } catch {
    return 0;
  }
}

/** slug → cached tool count for a bot's enabled connections. */
function connectionToolCounts(bot: {
  connections?: { connection: { slug: string; toolsCache: string } }[];
}): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const link of bot.connections ?? []) {
    counts[link.connection.slug] = toolCount(link.connection.toolsCache);
  }
  return counts;
}

/**
 * What the bot's durable conversation runs with: persona, model and
 * capabilities — its toolkits and connections, plus `skills` (always
 * selected: it lists only the bot's assigned skills, and `save_skill` asks).
 */
export function agentConfig(
  bot: Pick<Bot, "modelId" | "systemPrompt" | "toolkits" | "toolPermissions"> & {
    connectionCapabilities?: string[];
    /** Tools cached per enabled connection (slug → count), for the deferral threshold. */
    connectionToolCounts?: Record<string, number>;
  },
): BotAgentConfig {
  const largeServer = Object.values(bot.connectionToolCounts ?? {}).some(
    (count) => count > MCP_DEFER_THRESHOLD,
  );
  return {
    modelId: bot.modelId,
    systemPrompt: bot.systemPrompt,
    capabilities: {
      enabled: [
        ...bot.toolkits,
        "skills",
        // A model without native vision gets the see_image side-call toolkit
        // (issue #17), force-included like skills: it self-adjusts on model
        // switch, and a toggle would strand the bots that need it most.
        ...(modelSeesImages(bot.modelId) ? [] : ["vision"]),
        ...(bot.connectionCapabilities ?? []),
        ...(largeServer ? ["tool-search"] : []),
      ],
      permissions: bot.toolPermissions,
    },
  };
}

/** Reject toolkit ids the runtime doesn't know (typos, removed toolkits). */
function checkToolkits(rt: BotAgentRuntime, toolkits: string[] | undefined): void {
  if (!toolkits) return;
  const known = new Set(
    rt
      .listCapabilities()
      .filter((capability) => capability.kind === "toolkit")
      .map((capability) => capability.id),
  );
  const unknown = toolkits.filter((id) => !known.has(id));
  if (unknown.length > 0) throw Boom.badRequest(`Unknown toolkit "${unknown[0]}"`);
}

function runtime(): BotAgentRuntime {
  return getAgentRuntime();
}

/** Shape returned by the bots list: denormalised preview fields + unread. */
export interface BotListEntry {
  id: string;
  conversationId: string;
  name: string;
  description: string;
  modelId: string;
  lastMessagePreview: string | null;
  lastActivityAt: Date;
  unread: boolean;
  replying: boolean;
  /** Tool calls waiting for the owner's approval. */
  approvals: number;
}

function toListEntry(bot: BotRow, replying: boolean, approvals: number): BotListEntry {
  return {
    id: bot.id,
    conversationId: bot.conversationId,
    name: bot.name,
    description: bot.description,
    modelId: bot.modelId,
    lastMessagePreview: bot.lastMessagePreview,
    lastActivityAt: bot.lastActivityAt,
    unread: isUnread(bot),
    replying,
    approvals,
  };
}

/** Unread = an assistant reply newer than the user's last read marker. */
function isUnread(
  bot: Pick<BotRow, "lastReadAt" | "lastActivityAt" | "lastMessagePreview">,
): boolean {
  if (!bot.lastMessagePreview) return false;
  return bot.lastReadAt === null || bot.lastActivityAt > bot.lastReadAt;
}

export async function listBots(rt: BotAgentRuntime = runtime()) {
  const bots = await prisma.bot.findMany({ orderBy: { lastActivityAt: "desc" } });
  const busy = new Set(rt.busyConversations());
  return bots.map((bot) =>
    toListEntry(
      bot,
      busy.has(Number(bot.conversationId)),
      rt.pendingApprovals(Number(bot.conversationId)),
    ),
  );
}

async function findBot(id: string): Promise<BotWithLinks> {
  const bot = await prisma.bot.findUnique({ where: { id }, include: withLinks });
  if (!bot) throw Boom.notFound("Bot not found");
  return bot;
}

export async function getBot(id: string): Promise<Bot> {
  return toBot(await findBot(id));
}

export async function createBot(data: CreateBotDTO, rt: BotAgentRuntime = runtime()) {
  if (!rt.hasModel(data.modelId)) {
    throw Boom.badRequest(`Unknown model "${data.modelId}"`);
  }
  checkToolkits(rt, data.toolkits);
  const toolkits = data.toolkits ?? [];
  const toolPermissions = data.toolPermissions ?? {};
  const conversationId = await rt.createConversation(
    agentConfig({
      modelId: data.modelId,
      systemPrompt: data.systemPrompt,
      toolkits,
      toolPermissions,
    }),
  );
  // If the row insert fails the durable conversation is left orphaned — the
  // same end state as bot deletion, which Phase 2 cleanup will sweep.
  const row = await prisma.bot.create({
    data: {
      name: data.name,
      description: data.description,
      systemPrompt: data.systemPrompt,
      modelId: data.modelId,
      conversationId: String(conversationId),
      toolkits: JSON.stringify(toolkits),
      toolPermissions: JSON.stringify(toolPermissions),
    },
  });
  if (data.skillIds || data.connectionIds) {
    await setLinks(row.id, data.skillIds, data.connectionIds);
    return reconfigure(row.id, rt);
  }
  return getBot(row.id);
}

/** Replace a bot's skill and/or connection assignments (unknown ids are ignored). */
async function setLinks(botId: string, skillIds?: string[], connectionIds?: string[]) {
  if (skillIds) {
    const skills = await prisma.skill.findMany({
      where: { id: { in: skillIds } },
      select: { id: true },
    });
    await prisma.$transaction([
      prisma.botSkill.deleteMany({ where: { botId } }),
      prisma.botSkill.createMany({ data: skills.map((skill) => ({ botId, skillId: skill.id })) }),
    ]);
  }
  if (connectionIds) {
    const connections = await prisma.connection.findMany({
      where: { id: { in: connectionIds } },
      select: { id: true },
    });
    await prisma.$transaction([
      prisma.botConnection.deleteMany({ where: { botId } }),
      prisma.botConnection.createMany({
        data: connections.map((connection) => ({ botId, connectionId: connection.id })),
      }),
    ]);
  }
}

/** Re-apply a bot's stored configuration to its conversation (after link changes). */
export async function reconfigure(
  id: string,
  rt: Pick<BotAgentRuntime, "configure"> = runtime(),
): Promise<Bot> {
  const bot = await findBot(id);
  await rt.configure(Number(bot.conversationId), agentConfig(toBot(bot)));
  return toBot(bot);
}

export async function updateBot(id: string, data: UpdateBotDTO, rt: BotAgentRuntime = runtime()) {
  const row = await findBot(id);
  const bot = toBot(row);
  const modelId = data.modelId ?? bot.modelId;
  const systemPrompt = data.systemPrompt ?? bot.systemPrompt;
  if (data.modelId !== undefined && !rt.hasModel(modelId)) {
    throw Boom.badRequest(`Unknown model "${modelId}"`);
  }
  checkToolkits(rt, data.toolkits);
  const toolkits = data.toolkits ?? bot.toolkits;
  const toolPermissions = data.toolPermissions ?? bot.toolPermissions;
  await setLinks(id, data.skillIds, data.connectionIds);
  const after = data.connectionIds ? await findBot(id) : null;
  const links = after ?? row;
  await rt.configure(
    Number(bot.conversationId),
    agentConfig({
      modelId,
      systemPrompt,
      toolkits,
      toolPermissions,
      connectionCapabilities: after
        ? toBot(after).connectionCapabilities
        : bot.connectionCapabilities,
      connectionToolCounts: connectionToolCounts(links),
    }),
  );
  await prisma.bot.update({
    where: { id },
    data: {
      ...(data.toolkits !== undefined ? { toolkits: JSON.stringify(toolkits) } : {}),
      ...(data.toolPermissions !== undefined
        ? { toolPermissions: JSON.stringify(toolPermissions) }
        : {}),
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
      ...(data.systemPrompt !== undefined ? { systemPrompt } : {}),
      ...(data.modelId !== undefined ? { modelId } : {}),
    },
  });
  return getBot(id);
}

/**
 * Stop whatever a conversation the app no longer shows is still doing. A run
 * left going there would keep calling the model and its tools (e.g. creating
 * tasks) with nobody watching, and resume after every restart. Best effort:
 * the row change has already happened, so a failure here is only logged.
 */
async function retireConversation(rt: BotAgentRuntime, conversationId: string): Promise<void> {
  try {
    await rt.abort(Number(conversationId));
  } catch (error) {
    logger.warn({ error, conversationId }, "Failed to stop a retired bot conversation");
  }
}

export async function deleteBot(id: string, rt: BotAgentRuntime = runtime()) {
  const bot = await findBot(id);
  // The durable conversation's history stays orphaned in agent.db (PRD §5.1;
  // Phase 2 adds cleanup), but its in-flight work stops once the row is gone.
  const deleted = await prisma.bot.delete({ where: { id: bot.id } });
  await retireConversation(rt, bot.conversationId);
  return toBot(deleted);
}

export async function sendMessage(
  id: string,
  input: { requestId: string; text: string; mentions?: string[]; attachments?: string[] },
  rt: BotAgentRuntime = runtime(),
) {
  const bot = await getBot(id);
  const send = await resolveSend(bot, input);
  await rt.submit(Number(bot.conversationId), {
    requestId: input.requestId,
    text: send.text,
    ...(send.images ? { images: send.images } : {}),
    ...(send.attachments ? { attachments: send.attachments } : {}),
  });
  await prisma.bot.update({
    where: { id },
    data: {
      lastActivityAt: new Date(),
      lastMessagePreview: previewOf(input.text, send.attachments).slice(0, 120),
    },
  });
  if (input.mentions && input.mentions.length > 0) {
    await deliverMentions(bot, input, rt);
  }
}

/** Bot-list preview: text, else a hint of what was attached (issue #17). */
function previewOf(text: string, attachments: AttachmentRef[] | undefined): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed) return trimmed;
  if (!attachments?.length) return "";
  const first = attachments[0];
  return first.kind === "image"
    ? `[Image] ${attachments.filter((a) => a.kind === "image").length > 1 ? `+${attachments.length - 1} more` : first.name}`
    : `[File] ${first.name}`;
}

/** One send's resolved content: blocks for the model, refs for the entry. */
interface ResolvedSend {
  text: string;
  images?: { data: string; mimeType: string }[];
  attachments?: AttachmentRef[];
}

/**
 * Resolve a send's attachments (issue #17). Vision models get inline image
 * blocks; text-only models get a see_image note per image and file metadata
 * lines, so every model can reason about what arrived. Unknown upload ids
 * reject the send before anything durable happens.
 */
async function resolveSend(
  bot: Bot,
  input: { text: string; attachments?: string[] },
): Promise<ResolvedSend> {
  const ids = input.attachments ?? [];
  if (ids.length === 0) return { text: input.text };
  if (new Set(ids).size !== ids.length) throw Boom.badRequest("Duplicate attachment id");

  const rows = await prisma.upload.findMany({ where: { id: { in: ids } } });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const missing = ids.find((uploadId) => !byId.get(uploadId));
  if (missing) throw Boom.notFound(`Unknown attachment "${missing}"`);

  const attachments: AttachmentRef[] = ids.map((uploadId) => {
    const row = byId.get(uploadId)!;
    return {
      uploadId,
      kind: row.kind === "image" ? "image" : "file",
      name: row.name,
      mimeType: row.mimeType,
      size: row.size,
      ...(row.width !== null && row.height !== null
        ? { width: row.width, height: row.height }
        : {}),
    };
  });

  const images = attachments.filter((a) => a.kind === "image");
  const files = attachments.filter((a) => a.kind === "file");
  const text = input.text.trim();

  // Vision path: inline image blocks, the refs ride the entry.
  if (images.length > 0 && modelSeesImages(bot.modelId)) {
    const blocks: { data: string; mimeType: string }[] = [];
    for (const image of images) {
      const prepared = await modelImage(image.uploadId);
      if (prepared) blocks.push({ data: prepared.data, mimeType: prepared.mimeType });
    }
    if (blocks.length > 0) {
      return { text, images: blocks, attachments };
    }
    // Preparation failed for every image (swept storage): fall through to notes.
  }

  // Text-model path (or storage loss): describe attachments as text lines.
  const lines: string[] = [];
  for (const image of images) {
    const size = image.width && image.height ? `, ${image.width}x${image.height}` : "";
    lines.push(`[image attached: ${image.name}${size} (${image.uploadId})]`);
  }
  for (const file of files) {
    lines.push(
      `[file attached: ${file.name}, ${file.mimeType}, ${Math.round(file.size / 1024)} KB]`,
    );
  }
  const notes =
    lines.length > 0
      ? `${lines.join("\n")}${
          images.length > 0 && !modelSeesImages(bot.modelId)
            ? "\n(The owner attached image(s); call see_image with an id above to view.)"
            : ""
        }`
      : "";
  return {
    text: text ? `${text}\n\n${notes}` : notes.replace(/^\n+/, ""),
    attachments,
  };
}

/** The text a tagged bot receives: enough context to answer in-place. */
function mentionText(ownerContext: string, text: string): string {
  return `${ownerContext} ${text}`;
}

/**
 * Deliver a copy of the message to every @mentioned bot (issue #12). Each
 * delivery is a ledger row (kind="mention") whose answer relays back into
 * the host bot's conversation. Failures never fail the owner's send: the
 * host conversation already got the message.
 */
async function deliverMentions(
  host: Bot,
  input: { requestId: string; text: string; mentions?: string[] },
  rt: BotAgentRuntime,
): Promise<void> {
  const targets = await prisma.bot.findMany({
    where: { id: { in: input.mentions ?? [] }, NOT: { id: host.id } },
    select: { id: true, name: true, conversationId: true },
  });
  if (targets.length === 0) return;
  const ownerContext = `[From the owner, in ${host.name}'s chat]`;
  for (const target of targets) {
    try {
      const existing = await prisma.botMessage.findUnique({
        where: { requestId: `mention-${input.requestId}-${target.id}` },
      });
      if (existing) continue;
      await rt.submit(Number(target.conversationId), {
        requestId: `mention-${input.requestId}-${target.id}`,
        text: mentionText(ownerContext, sanitizePeerText(input.text)),
      });
      await prisma.botMessage.create({
        data: {
          fromBotId: null,
          toBotId: target.id,
          replyToBotId: host.id,
          kind: "mention",
          requestId: `mention-${input.requestId}-${target.id}`,
          text: input.text,
          deliveredAt: new Date(),
        },
      });
    } catch (error) {
      logger.warn({ error, hostId: host.id, targetId: target.id }, "Mention delivery failed");
    }
  }
}

export async function abortReply(id: string) {
  const bot = await getBot(id);
  await runtime().abort(Number(bot.conversationId));
}

export async function resetConversation(id: string, rt: BotAgentRuntime = runtime()) {
  const row = await findBot(id);
  const bot = toBot(row);
  // Fresh conversation; the old one stays in agent.db, hidden (PRD §5.1),
  // and any reply still running there is stopped.
  const conversationId = await rt.createConversation(
    agentConfig({ ...bot, connectionToolCounts: connectionToolCounts(row) }),
  );
  await prisma.bot.update({
    where: { id },
    data: {
      conversationId: String(conversationId),
      lastReadAt: new Date(),
      lastMessagePreview: null,
      lastActivityAt: new Date(),
    },
  });
  await retireConversation(rt, bot.conversationId);
  return getBot(id);
}

export async function markRead(id: string) {
  await findBot(id);
  await prisma.bot.update({ where: { id }, data: { lastReadAt: new Date() } });
  return getBot(id);
}

/**
 * Answer a tool call waiting for approval. "Always allow" also switches the
 * tool to `allow` for this bot (applies from its next call).
 */
export async function decideApproval(
  id: string,
  input: { taskId: number; decision: "approved" | "denied"; alwaysAllow?: string },
  rt: BotAgentRuntime = runtime(),
) {
  const row = await findBot(id);
  const bot = toBot(row);
  const conversation = Number(bot.conversationId);
  if (input.decision === "approved" && input.alwaysAllow) {
    const toolPermissions = { ...bot.toolPermissions, [input.alwaysAllow]: "allow" as const };
    await rt.configure(
      conversation,
      agentConfig({ ...bot, toolPermissions, connectionToolCounts: connectionToolCounts(row) }),
    );
    await prisma.bot.update({
      where: { id },
      data: { toolPermissions: JSON.stringify(toolPermissions) },
    });
  }
  try {
    await rt.decideApproval(conversation, input.taskId, input.decision);
  } catch (error) {
    if (error instanceof ApprovalNotPendingError) throw Boom.conflict(error.message);
    throw error;
  }
}

/**
 * Fold a completed reply into the bot row's denormalised list fields. Called
 * from the activity feed when a bot stops replying.
 */
export async function recordReply(
  conversationId: string,
  last: { role: "user" | "assistant"; text: string; createdAt: number } | undefined,
) {
  if (!last) return;
  const preview = last.text.replace(/\s+/g, " ").trim().slice(0, 120);
  await prisma.bot
    .updateMany({
      where: { conversationId },
      data: { lastMessagePreview: preview || null, lastActivityAt: new Date(last.createdAt) },
    })
    .catch(() => undefined);
}
