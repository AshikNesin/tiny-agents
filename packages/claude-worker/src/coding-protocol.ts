/**
 * Coding mode on the worker socket: the Code page's Claude Code sessions.
 *
 * Every message is namespaced `coding.*`, so the bot protocol in
 * `protocol.ts` is untouched. Requests carry a `requestId` and get exactly
 * one `reply` (the socket's envelope, `envelope.ts`, shared with the bot
 * protocol). Session events carry a per-session `seq` and are kept
 * in a replay buffer for `coding.resume`, like bot sessions. Streaming text
 * (`coding.partial`) and the command catalog are not sequenced: they are
 * ephemeral and a reconnect starts from a fresh snapshot anyway.
 */
import { z } from "zod";
import type { ResumeResult } from "./envelope";
import type { Sequenced } from "./session-log";

export const DEFAULT_CODING_LIMITS = {
  /** Coding processes alive at once (their own budget, separate from bot chats). */
  maxLiveProcesses: 3,
  /** Coding turns running at once. */
  maxRunningTurns: 2,
  /** Close an idle coding process after this long; the Claude session id is kept for resume. */
  idleEvictMs: 30 * 60_000,
  /** Events retained per coding session so a reconnecting client can resume. */
  eventBuffer: 2_000,
  /** After a stop, end the turn ourselves when Claude Code sends no result within this long. */
  stopGraceMs: 15_000,
  maxUploadBytes: 25 * 1024 * 1024,
  maxAssetBytes: 10 * 1024 * 1024,
} as const;

export type CodingLimits = {
  [K in keyof typeof DEFAULT_CODING_LIMITS]: number;
};

export function codingLimitsFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  defaults: CodingLimits = DEFAULT_CODING_LIMITS,
): CodingLimits {
  const num = (key: string, fallback: number): number => {
    const raw = env[key]?.trim();
    if (!raw) return fallback;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };
  return {
    ...defaults,
    maxLiveProcesses: num("CLAUDE_WORKER_CODING_MAX_PROCESSES", defaults.maxLiveProcesses),
    maxRunningTurns: num("CLAUDE_WORKER_CODING_MAX_TURNS", defaults.maxRunningTurns),
    idleEvictMs: num("CLAUDE_WORKER_CODING_IDLE_MS", defaults.idleEvictMs),
  };
}

export const CODING_PERMISSION_MODES = [
  "default",
  "acceptEdits",
  "plan",
  "bypassPermissions",
] as const;
export type CodingPermissionMode = (typeof CODING_PERMISSION_MODES)[number];

export const CODING_EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
export type CodingEffortLevel = (typeof CODING_EFFORT_LEVELS)[number];

/** New coding sessions start here (owner decision). */
export const DEFAULT_CODING_PERMISSION_MODE: CodingPermissionMode = "acceptEdits";

/**
 * Attachments travel as file paths in the prompt (Claude Code reads them with
 * its own Read tool, images included), under this header. The driver strips
 * the block back out of the transcript and shows the files as attachments.
 */
export const ATTACHMENTS_HEADER = "Attached files (read them with the Read tool):";

export function promptWithAttachments(
  text: string,
  attachments: readonly { path: string }[] | undefined,
): string {
  if (!attachments?.length) return text;
  const list = attachments.map((file) => `- ${file.path}`).join("\n");
  return `${text}${text ? "\n\n" : ""}${ATTACHMENTS_HEADER}\n${list}`;
}

const id = z.string().min(1).max(200);
const requestId = z.string().min(1).max(100);
const absolutePath = z.string().min(1).max(4096);

export const codingSessionConfigSchema = z.strictObject({
  cwd: absolutePath,
  /** Claude session id to resume when a process starts. */
  resume: z.string().min(1).max(200).optional(),
  model: z.string().min(1).max(200).nullable().optional(),
  effort: z.enum(CODING_EFFORT_LEVELS).nullable().optional(),
  permissionMode: z.enum(CODING_PERMISSION_MODES).nullable().optional(),
});

export type CodingSessionConfig = z.infer<typeof codingSessionConfigSchema>;

export const codingAttachmentSchema = z.strictObject({
  path: absolutePath,
  name: z.string().max(512),
  image: z.boolean(),
});

export type CodingAttachment = z.infer<typeof codingAttachmentSchema>;

export const codingAnswerSchema = z.union([
  z.strictObject({ decision: z.enum(["allow", "deny"]), message: z.string().max(4000).optional() }),
  z.strictObject({ answers: z.record(z.string(), z.string()) }),
]);

export type CodingAnswer = z.infer<typeof codingAnswerSchema>;

export const codingSettingsChangeSchema = z.strictObject({
  model: z.string().min(1).max(200).nullable().optional(),
  effort: z.enum(CODING_EFFORT_LEVELS).nullable().optional(),
  permissionMode: z.enum(CODING_PERMISSION_MODES).nullable().optional(),
});

export type CodingSettingsChange = z.infer<typeof codingSettingsChangeSchema>;

const diffId = z.string().regex(/^(working|[0-9a-f]{7,40})$/);

/** The fixed set of workspace operations. Each runs `git` or `fs`, never a shell. */
export const codingOpSchema = z.discriminatedUnion("op", [
  z.strictObject({
    op: z.literal("git_log"),
    cwd: absolutePath,
    limit: z.number().int().positive().max(200).optional(),
  }),
  z.strictObject({ op: z.literal("git_files"), cwd: absolutePath, diffId }),
  z.strictObject({
    op: z.literal("git_file"),
    cwd: absolutePath,
    diffId,
    path: z.string().min(1).max(4096),
  }),
  /** A fingerprint of the repository's changes (`changeStamp`), to poll cheaply. */
  z.strictObject({ op: z.literal("git_stamp"), cwd: absolutePath }),
  z.strictObject({
    op: z.literal("find_files"),
    dir: absolutePath,
    query: z.string().max(500),
    content: z.literal("only").optional(),
    limit: z.number().int().positive().max(500).optional(),
  }),
  z.strictObject({ op: z.literal("list_dir"), path: absolutePath.optional() }),
  z.strictObject({ op: z.literal("validate_cwd"), path: z.string().max(4096) }),
  z.strictObject({
    op: z.literal("upload"),
    filename: z.string().min(1).max(512),
    /** base64 */
    data: z.string(),
  }),
  z.strictObject({ op: z.literal("read_asset"), ref: absolutePath }),
]);

export type CodingOp = z.infer<typeof codingOpSchema>;

export const codingClientMessageSchema = z.discriminatedUnion("type", [
  /** Subscribe this socket to coding events; answers the worker's boot id. */
  z.strictObject({ type: z.literal("coding.hello"), requestId }),
  z.strictObject({
    type: z.literal("coding.send"),
    requestId,
    sessionId: id,
    /** Opens the session when the worker does not know it (a worker restart). */
    session: codingSessionConfigSchema,
    /** Client-chosen message uuid: retries are idempotent and history keeps it. */
    uuid: z.uuid(),
    text: z.string().max(200_000),
    /** steer: inject into the running turn; queue: hold until it ends. Idle: start a turn. */
    mode: z.enum(["steer", "queue"]),
    attachments: z.array(codingAttachmentSchema).max(20).optional(),
  }),
  z.strictObject({ type: z.literal("coding.interrupt"), requestId, sessionId: id }),
  z.strictObject({
    type: z.literal("coding.respond"),
    requestId,
    sessionId: id,
    approvalId: id,
    answer: codingAnswerSchema,
  }),
  z.strictObject({
    type: z.literal("coding.settings"),
    requestId,
    sessionId: id,
    session: codingSessionConfigSchema,
    change: codingSettingsChangeSchema,
  }),
  z.strictObject({
    type: z.literal("coding.queue"),
    requestId,
    sessionId: id,
    action: z.enum(["send", "cancel"]),
    queuedId: id,
  }),
  z.strictObject({
    type: z.literal("coding.history"),
    requestId,
    claudeSessionId: id,
    cwd: absolutePath,
  }),
  z.strictObject({
    type: z.literal("coding.fork"),
    requestId,
    claudeSessionId: id,
    cwd: absolutePath,
    upToMessageId: id.optional(),
    title: z.string().max(500).optional(),
  }),
  z.strictObject({ type: z.literal("coding.commands"), requestId }),
  z.strictObject({ type: z.literal("coding.op"), requestId, op: codingOpSchema }),
  z.strictObject({
    type: z.literal("coding.resume"),
    requestId,
    sessionId: id,
    afterSeq: z.number().int().nonnegative(),
  }),
  /** End the session's process (archive). The Claude session stays resumable. */
  z.strictObject({ type: z.literal("coding.close"), requestId, sessionId: id }),
]);

export type CodingClientMessage = z.infer<typeof codingClientMessageSchema>;

export const codingQueuedSchema = z.strictObject({
  id,
  text: z.string(),
  createdAt: z.string(),
});

export type CodingQueued = z.infer<typeof codingQueuedSchema>;

export const codingStateSchema = z.strictObject({
  /** A turn is in flight (sent to Claude Code, no result yet). */
  running: z.boolean(),
  /** A Claude Code process is alive for this session. */
  live: z.boolean(),
  claudeSessionId: z.string().optional(),
  queued: z.array(codingQueuedSchema),
  settings: z.strictObject({
    model: z.string().nullable(),
    effort: z.string().nullable(),
    permissionMode: z.string().nullable(),
  }),
});

export type CodingState = z.infer<typeof codingStateSchema>;

export const codingApprovalSchema = z.strictObject({
  approvalId: id,
  toolUseId: z.string().optional(),
  toolName: z.string().min(1),
  input: z.unknown(),
  /** The SDK's `suggestions` (permission updates), passed through for display. */
  suggestions: z.array(z.unknown()).optional(),
  /** The SDK's `decisionReason`. */
  reason: z.string().optional(),
  title: z.string().optional(),
  blockedPath: z.string().optional(),
  agentId: z.string().optional(),
});

export type CodingApproval = z.infer<typeof codingApprovalSchema>;

export const codingEventSchema = z.discriminatedUnion("type", [
  /**
   * An SDK message (assistant, user, compact boundary, result…), or the
   * worker's echo of a prompt it sent. Results gain `turn_cost_usd`,
   * `turn_model_usage`, `after_uuid` and, when it applies, `usage_limit` /
   * `interrupted`; a turn the process never finished gets a synthetic result.
   */
  z.strictObject({
    type: z.literal("message"),
    message: z.looseObject({ type: z.string() }),
  }),
  z.strictObject({ type: z.literal("state"), state: codingStateSchema }),
  z.strictObject({ type: z.literal("request"), approval: codingApprovalSchema }),
  z.strictObject({
    type: z.literal("request_closed"),
    approvalId: id,
    status: z.enum(["allowed", "denied", "answered", "expired"]),
  }),
]);

export type CodingEvent = z.infer<typeof codingEventSchema>;

export const codingCatalogSchema = z.strictObject({
  commands: z.array(
    z.looseObject({
      name: z.string(),
      description: z.string().optional(),
      argumentHint: z.string().optional(),
    }),
  ),
  models: z.array(
    z.looseObject({
      value: z.string(),
      displayName: z.string().optional(),
      description: z.string().optional(),
      supportedEffortLevels: z.array(z.string()).optional(),
    }),
  ),
});

export type CodingCatalog = z.infer<typeof codingCatalogSchema>;

export const codingWorkerMessageSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("coding.event"),
    sessionId: id,
    seq: z.number().int().positive(),
    event: codingEventSchema,
  }),
  z.strictObject({
    type: z.literal("coding.partial"),
    sessionId: id,
    /** Start of a new assistant message: drop what was streamed so far. */
    reset: z.boolean().optional(),
    text: z.string().optional(),
    thinking: z.string().optional(),
  }),
  z.strictObject({ type: z.literal("coding.catalog"), catalog: codingCatalogSchema }),
]);

export type CodingWorkerMessage = z.infer<typeof codingWorkerMessageSchema>;

export function parseCodingClientMessage(value: unknown): CodingClientMessage | undefined {
  const parsed = codingClientMessageSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function parseCodingWorkerMessage(value: unknown): CodingWorkerMessage | undefined {
  const parsed = codingWorkerMessageSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function isCodingMessage(value: unknown): boolean {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { type?: unknown }).type === "string" &&
    (value as { type: string }).type.startsWith("coding.")
  );
}

/** Buffered coding event as the worker stores and replays it. */
export type CodingSequencedEvent = Sequenced<CodingEvent>;

// --- reply payloads (not validated on the wire: the client trusts its worker) ---

export interface CodingHelloResult {
  /** Changes when the worker restarts: every session's seq starts again. */
  bootId: string;
  /** Sessions the worker holds, so a restarted client can pick up running turns. */
  sessions: Array<{ sessionId: string; running: boolean; live: boolean; lastSeq: number }>;
}

export interface CodingSendResult {
  status: "accepted" | "queued";
  queuedId?: string;
}

/** `coding.resume` answers the envelope's resume result. */
export type CodingResumeResult = ResumeResult;

export interface CodingSettingsResult {
  settings: CodingState["settings"];
  /** live: applied to the running process; next_process: applies when it restarts. */
  applied: "live" | "next_process" | "stored";
}

/** One entry of `getSessionMessages`. */
export interface CodingHistoryMessage {
  type: string;
  uuid: string;
  session_id: string;
  message: unknown;
  parent_tool_use_id: string | null;
  [key: string]: unknown;
}

export interface CodingHistoryResult {
  messages: CodingHistoryMessage[];
}

export interface CodingForkResult {
  sessionId: string;
}

// Op results mirror `@tiny-agents/code/contracts` (GitDiff, GitFile, …) by shape.

export interface CodingGitDiff {
  id: string;
  message: string;
  author: string;
  timestamp: string;
  filesCount: number;
  additions: number;
  deletions: number;
  refs?: string[];
}

export interface CodingGitLogResult {
  gitRoot: string;
  diffs: CodingGitDiff[];
}

export interface CodingGitFile {
  path: string;
  status: "added" | "modified" | "deleted";
  additions: number;
  deletions: number;
  isGenerated: boolean;
  binary?: boolean;
}

export interface CodingGitFileDiff {
  path: string;
  oldContent: string;
  newContent: string;
  unshowable?: "binary" | "tooLarge";
}

export interface CodingGitStamp {
  stamp: string;
}

export interface CodingFileMatch {
  path: string;
  isDir?: boolean;
  line?: number;
  text?: string;
}

export interface CodingDirectoryListing {
  path: string;
  parent?: string;
  entries: Array<{ name: string; isDir: boolean }>;
  repoRoot?: string;
  headSubject?: string;
}

export interface CodingAsset {
  name: string;
  mimeType: string;
  /** base64 */
  data: string;
}
