/**
 * A bot's durable conversation, kept in step with its row.
 *
 * The `Bot` row (app.db) is the source of truth for persona, model, tool
 * permissions and links; the durable conversation (agent.db) runs with the
 * config of its last configure. Every path that puts a message in front of a
 * bot (owner sends, mentions, relayed replies, bot-to-bot messages, routine
 * fires) must reconcile first, or drift (a model that gained vision, a
 * toolkit edited in the row, a connection added) silently strands old
 * selections. This module is the one place that does it: callers name the
 * bot and what to deliver, never the config.
 */
import { prisma } from "@groot/core/database";
import { Boom } from "@groot/core/errors";
import {
  fenceAttachment,
  MCP_DEFER_THRESHOLD,
  UNTRUSTED_RULE,
  type AgentRuntime,
  type AttachmentRef,
  type BotAgentConfig,
  type ChatMessage,
  type ToolPermission,
} from "@tiny-agents/agent";
import { modelImage } from "../uploads/uploads.service";
import { loadContent } from "../uploads/uploads.extraction";
import { summarize } from "../uploads/uploads.store";

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
  /** JSON object: tool name → permission. */
  toolPermissions: string;
  /** Memory capture + injection switch (issue #22). */
  memoryEnabled: boolean;
  /** Transcript watermark: owner turns captured through this instant. */
  memoryCapturedThrough: Date | null;
  /** Set while the bot is pinned to the top of the sidebar. */
  pinnedAt: Date | null;
  /** "shared" (the default browser profile) or "own". */
  browserProfile: string;
  createdAt: Date;
  updatedAt: Date;
}

/** The bot as the API returns it: capability columns parsed, skills and connections by id. */
export type Bot = Omit<BotRow, "toolPermissions"> & {
  toolPermissions: Record<string, ToolPermission>;
  skillIds: string[];
  connectionIds: string[];
  /** Capability ids of the bot's connections (`mcp:<slug>`). */
  connectionCapabilities: string[];
};

type ConnectionLink = {
  connectionId: string;
  connection: { slug: string; toolsCache: string; disabledTools: string };
};

type BotWithLinks = BotRow & {
  skills?: { skillId: string }[];
  connections?: ConnectionLink[];
};

const withLinks = {
  skills: { select: { skillId: true } },
  connections: {
    select: {
      connectionId: true,
      connection: { select: { slug: true, toolsCache: true, disabledTools: true } },
    },
  },
} as const;

/**
 * The built-in toolkits every bot gets. There is no per-bot selection: a bot
 * is shaped by its tool permissions (Off removes a tool from the model), and
 * effectful tools ask the owner before they run (ADR 0004).
 */
export const BOT_TOOLKITS = [
  "tasks",
  "routines",
  "web",
  "sandbox",
  "browser",
  "bots",
  "skills",
  "memory",
  "today",
  "questions",
  "vault",
  "attachments",
] as const;

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
    toolPermissions: parseJson<Record<string, ToolPermission>>(row.toolPermissions, {}),
    skillIds: skills?.map((link) => link.skillId) ?? [],
    connectionIds: connections?.map((link) => link.connectionId) ?? [],
    connectionCapabilities:
      connections?.map((link) => connectionCapabilityId(link.connection.slug)) ?? [],
  };
}

/** A bot's row with its links, or 404. */
export async function findBotRow(id: string): Promise<BotWithLinks> {
  const bot = await prisma.bot.findUnique({ where: { id }, include: withLinks });
  if (!bot) throw Boom.notFound("Bot not found");
  return bot;
}

/** What the conversation module needs from the runtime. */
export type BotConversationRuntime = Pick<
  AgentRuntime,
  "createConversation" | "configure" | "submit" | "listModels"
>;

/** Whether the bot's model reads image blocks natively (else the see_image side-call). */
function modelSeesImages(rt: Pick<AgentRuntime, "listModels">, modelId: string): boolean {
  try {
    return Boolean(rt.listModels().find((m) => m.id === modelId)?.vision);
  } catch {
    return false; // a partial runtime (tests): treat as text-only
  }
}

/** A bot that does not exist yet: the fields its first conversation is created from. */
export interface BotDraft {
  modelId: string;
  systemPrompt: string;
  toolPermissions: Record<string, ToolPermission>;
}

/**
 * What the bot's durable conversation runs with: persona, model and
 * capabilities: every built-in toolkit, its connections, and the automatic
 * ones (vision for text-only models, tool search for large connections).
 */
function agentConfig(
  bot: BotDraft & { connections?: ConnectionLink[] },
  rt: Pick<AgentRuntime, "listModels">,
): BotAgentConfig {
  const connections = bot.connections ?? [];
  const largeServer = connections.some(
    (link) => enabledToolCount(link.connection) > MCP_DEFER_THRESHOLD,
  );
  return {
    modelId: bot.modelId,
    systemPrompt: bot.systemPrompt,
    capabilities: {
      enabled: [
        ...BOT_TOOLKITS,
        // The see_image side-call is only for models without native vision.
        ...(modelSeesImages(rt, bot.modelId) ? [] : ["vision"]),
        ...connections.map((link) => connectionCapabilityId(link.connection.slug)),
        ...(largeServer ? ["tool-search"] : []),
      ],
      permissions: bot.toolPermissions,
    },
  };
}

/** Tools the connection installs: the cached list minus those turned off. */
function enabledToolCount(connection: ConnectionLink["connection"]): number {
  const tools = parseJson<unknown>(connection.toolsCache, []);
  const disabled = parseJson<unknown>(connection.disabledTools, []);
  if (!Array.isArray(tools)) return 0;
  const off = new Set(Array.isArray(disabled) ? disabled : []);
  return tools.filter((tool: { name?: unknown }) => !off.has(tool?.name)).length;
}

function rowConfig(row: BotWithLinks, rt: Pick<AgentRuntime, "listModels">): BotAgentConfig {
  return agentConfig({ ...toBot(row), connections: row.connections }, rt);
}

/**
 * Open a fresh durable conversation for a new bot (from its draft) or an
 * existing one (by id, from its row). Returns the id to store on the row.
 */
export async function startBotConversation(
  bot: string | BotDraft,
  rt: BotConversationRuntime,
): Promise<string> {
  const config =
    typeof bot === "string" ? rowConfig(await findBotRow(bot), rt) : agentConfig(bot, rt);
  return String(await rt.createConversation(config));
}

/** Re-apply a bot's stored configuration to its conversation (after row or link changes). */
export async function reconcileBotConversation(
  id: string,
  rt: Pick<BotConversationRuntime, "configure" | "listModels">,
): Promise<Bot> {
  const row = await findBotRow(id);
  await rt.configure(Number(row.conversationId), rowConfig(row, rt));
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
  /** Placement while a reply runs: "steer" joins it, "followUp" (default) waits. */
  whenBusy?: "steer" | "followUp";
}

/**
 * Deliver a message to a bot: resolve its attachments for the bot's model,
 * reconcile the conversation with the row, then submit. Throws 404 for an
 * unknown bot and rejects bad attachments before anything durable happens.
 * Returns the bot and the attachment refs stored on the entry.
 */
export async function submitToBot(
  id: string,
  submission: BotSubmission,
  rt: BotConversationRuntime,
): Promise<{ bot: Bot; attachments?: AttachmentRef[] }> {
  const row = await findBotRow(id);
  const resolved = await resolveAttachments(row.modelId, submission, rt);
  const conversation = Number(row.conversationId);
  await rt.configure(conversation, rowConfig(row, rt));
  await rt.submit(conversation, {
    requestId: submission.requestId,
    text: resolved.text,
    ...(resolved.images ? { images: resolved.images } : {}),
    ...(resolved.attachments ? { attachments: resolved.attachments } : {}),
    ...(submission.peer ? { peer: submission.peer } : {}),
    ...(submission.whenBusy ? { whenBusy: submission.whenBusy } : {}),
  });
  return {
    bot: toBot(row),
    ...(resolved.attachments ? { attachments: resolved.attachments } : {}),
  };
}

/** One send's resolved content: blocks for the model, refs for the entry. */
interface ResolvedSend {
  text: string;
  images?: { data: string; mimeType: string }[];
  attachments?: AttachmentRef[];
}

/** Inline a file's text when it is at most this long (≈8k tokens)… */
const INLINE_FILE_CHARS = 32_000;
/** …and while the send's inlined text stays under this (≈24k tokens). */
const INLINE_SEND_CHARS = 96_000;
/** How long a send waits for extractions still running (small files finish first). */
const EXTRACT_WAIT_MS = 5_000;

type UploadRow = Awaited<ReturnType<typeof prisma.upload.findMany>>[number];

/** Re-read rows still extracting until they settle or the wait runs out. */
async function settledRows(rows: UploadRow[]): Promise<UploadRow[]> {
  const deadline = Date.now() + EXTRACT_WAIT_MS;
  let current = rows;
  while (current.some((row) => row.kind === "file" && row.extractStatus === "pending")) {
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
    const fresh = await prisma.upload.findMany({ where: { id: { in: current.map((r) => r.id) } } });
    const byId = new Map(fresh.map((row) => [row.id, row]));
    current = current.map((row) => byId.get(row.id) ?? row);
  }
  return current;
}

/**
 * One file as the model meets it (issue #58): a reference line with its id
 * and state, plus its whole text, fenced as untrusted, when it is small and
 * the send's budget allows; otherwise the outline only, for the tools.
 */
async function fileNote(row: UploadRow, budget: { left: number }): Promise<string> {
  const summary = summarize(row);
  const facts = [summary.mimeType, `${Math.max(1, Math.round(summary.size / 1024))} KB`];
  if (summary.pages) facts.push(`${summary.pages} page${summary.pages === 1 ? "" : "s"}`);
  if (summary.sheets) facts.push(`${summary.sheets} sheet${summary.sheets === 1 ? "" : "s"}`);
  if (summary.lines) facts.push(`${summary.lines} lines`);
  if (summary.entries) facts.push(`${summary.entries} entries`);
  const state =
    summary.status === "ready"
      ? "ready"
      : summary.status === "failed" || summary.status === "unsupported"
        ? `${summary.status}${summary.error ? ` (${summary.error})` : ""}`
        : "extracting";
  const line = `[file attached: ${row.name} (id ${row.id}), ${facts.join(", ")}, status: ${state}]`;
  if (summary.status !== "ready") return line;
  const content = await loadContent(row.id);
  if (!content) return line;
  if (content.entries) {
    const shown = content.entries.slice(0, 50).map((e) => (e.dir ? `${e.path}/` : e.path));
    const more =
      content.entries.length > shown.length
        ? `\n… ${content.entries.length - shown.length} more`
        : "";
    return `${line}\n${fenceAttachment(summary, shown.join("\n") + more)}`;
  }
  const text = content.pages.map((page) => page.text).join("\n");
  if (text.length <= INLINE_FILE_CHARS && text.length <= budget.left) {
    budget.left -= text.length;
    return `${line}\n${fenceAttachment(summary, text)}`;
  }
  const outline = content.outline?.slice(0, 12).join(" · ");
  return outline ? `${line}\n  Outline: ${outline.slice(0, 400)}` : line;
}

/**
 * Resolve a send's attachments (issue #17). Vision models get inline image
 * blocks; text-only models get a see_image note per image. Files get a
 * reference line each (issue #58) and, when small, their text inline, so
 * every model can work with what arrived.
 */
async function resolveAttachments(
  modelId: string,
  input: { text: string; attachments?: string[] },
  rt: Pick<AgentRuntime, "listModels">,
): Promise<ResolvedSend> {
  const ids = input.attachments ?? [];
  if (ids.length === 0) return { text: input.text };
  if (new Set(ids).size !== ids.length) throw Boom.badRequest("Duplicate attachment id");

  const found = await prisma.upload.findMany({ where: { id: { in: ids } } });
  const rows = await settledRows(found);
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
      ...(row.kind === "file" ? { status: summarize(row).status } : {}),
    };
  });

  const images = attachments.filter((a) => a.kind === "image");
  const fileRows = ids.map((id) => byId.get(id)!).filter((row) => row.kind !== "image");
  const text = input.text.trim();
  const seesImages = modelSeesImages(rt, modelId);

  const budget = { left: INLINE_SEND_CHARS };
  const fileLines: string[] = [];
  for (const row of fileRows) fileLines.push(await fileNote(row, budget));
  const fileNotes =
    fileLines.length > 0
      ? `${fileLines.join("\n")}\n(Read or search files with read_attachment / search_attachment and the id. ${UNTRUSTED_RULE})`
      : "";
  const join = (...parts: string[]) => parts.filter(Boolean).join("\n\n");

  // Vision path: inline image blocks, the refs ride the entry.
  if (images.length > 0 && seesImages) {
    const blocks: { data: string; mimeType: string }[] = [];
    for (const image of images) {
      const prepared = await modelImage(image.uploadId);
      if (prepared) blocks.push({ data: prepared.data, mimeType: prepared.mimeType });
    }
    if (blocks.length > 0) {
      return { text: join(text, fileNotes), images: blocks, attachments };
    }
    // Preparation failed for every image (swept storage): fall through to notes.
  }

  // Text-model path (or storage loss): describe images as text lines.
  const imageLines = images.map((image) => {
    const size = image.width && image.height ? `, ${image.width}x${image.height}` : "";
    return `[image attached: ${image.name}${size} (${image.uploadId})]`;
  });
  const imageNotes =
    imageLines.length > 0
      ? `${imageLines.join("\n")}${
          !seesImages
            ? "\n(The owner attached image(s); call see_image with an id above to view.)"
            : ""
        }`
      : "";
  return { text: join(text, imageNotes, fileNotes), attachments };
}
