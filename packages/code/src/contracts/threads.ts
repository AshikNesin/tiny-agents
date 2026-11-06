/**
 * Threads, their live state, and everything around them a harness may
 * serve: settings, queued messages, background jobs, usage, the workspace.
 */
import type { HarnessKind, InstanceId, ThreadId } from "./ids";
import type { TranscriptItem } from "./items";

/** Claude Code's permission modes; harnesses offer only the ones they enforce. */
export type PermissionMode = "default" | "acceptEdits" | "plan" | "bypassPermissions";

export interface ThreadSummary {
  id: ThreadId;
  instanceId: InstanceId;
  kind: HarnessKind;
  nativeId: string;
  title: string;
  cwd: string | null;
  model: string | null;
  parentId: ThreadId | null;
  createdAt: string;
  updatedAt: string;
  working: boolean;
  archived: boolean;
  /** Highest position in the transcript (for unread). */
  cursor: number;
  preview?: string;
  subagentCount?: number;
  runningJobs?: number;
  queuedCount?: number;
  /** The last turn was cut off (a restart, a crash) and can be resumed. */
  turnInterrupted?: boolean;
  repoRoot?: string | null;
  gitCommit?: string | null;
  gitSubject?: string | null;
  permissionMode?: PermissionMode | null;
  /** The thread in the harness's own UI ("Open in Shelley"), when it has one. */
  externalUrl?: string;
  /** App-decorated: started, opened or handed off here. */
  followed?: boolean;
  /** App-decorated: its turn ended after the owner last looked. */
  unread?: boolean;
}

export interface ThreadSettings {
  model: string | null;
  /** Reasoning effort / thinking level; null = the harness default. */
  effort: string | null;
  permissionMode: PermissionMode | null;
}

export interface QueuedMessage {
  id: string;
  text: string;
  createdAt: string;
  /** A subagent reporting back, rather than the owner. */
  from?: string;
}

export interface BackgroundJob {
  id: string;
  command: string;
  startedAt?: string;
}

/** Everything the conversation view needs, read at once. */
export interface ThreadSnapshot {
  thread: ThreadSummary;
  items: TranscriptItem[];
  settings: ThreadSettings;
  queued: QueuedMessage[];
  jobs: BackgroundJob[];
  children: ThreadSummary[];
  /** Tokens in context now, and the model's window (when known). */
  context: { used: number; max?: number };
  costUsd: number;
}

/**
 * A conversation's state now, for hand-offs and bot tools. Every driver
 * builds it with the one turn-outcome rule (`turnOutcome`,
 * `@tiny-agents/code/server`).
 */
export interface TurnOutcome {
  working: boolean;
  title: string;
  cwd: string | null;
  /** The newest turn's answer or error, chat-sized; empty when it has none yet. */
  text: string;
  /** That answer is an error. */
  failed: boolean;
  /** When the harness last wrote to the newest turn (ms, its own record); absent while working. */
  endedAt?: number;
  cursor: number;
}

export interface ModelOption {
  id: string;
  label: string;
  isDefault?: boolean;
  ready?: boolean;
  contextWindow?: number;
  supportsReasoning?: boolean;
  supportsImages?: boolean;
}

export interface CreateThreadInput {
  message: string;
  cwd?: string;
  model?: string;
  effort?: string;
  permissionMode?: PermissionMode;
  attachments?: string[];
}

export interface SendInput {
  message: string;
  /** Asset refs from `upload`. */
  attachments?: string[];
  /** Hold the message until the running turn ends instead of steering it. */
  queue?: boolean;
  skills?: string[];
}

export interface Skill {
  name: string;
  description?: string;
}

export interface SlashCommand {
  command: string;
  hint: string;
}

export interface FileMatch {
  path: string;
  isDir?: boolean;
  line?: number;
  text?: string;
}

export interface DirectoryListing {
  path: string;
  parent?: string;
  entries: Array<{ name: string; isDir: boolean }>;
  repoRoot?: string;
  headSubject?: string;
}

export interface GitDiff {
  id: string;
  message: string;
  author: string;
  timestamp: string;
  filesCount: number;
  additions: number;
  deletions: number;
  refs?: string[];
}

export interface GitFile {
  path: string;
  status: "added" | "modified" | "deleted";
  additions: number;
  deletions: number;
  isGenerated: boolean;
}

export interface GitFileDiff {
  path: string;
  oldContent: string;
  newContent: string;
}

/** One token band of one model's usage (the context popup). */
export interface UsageBand {
  label: string;
  /** Chip color (any CSS color). */
  color: string;
  tokens: number;
  costUsd: number;
  /** USD per million tokens; null when served at mixed rates. */
  unitPrice: number | null;
  priced: boolean;
  /** Built from an aggregate: token counts only, no per-band price. */
  aggregate?: boolean;
}

export interface UsageRow {
  /** Model id, or the purpose for indirect usage. */
  label: string;
  /** Empty for indirect usage rows (they show tokens and calls). */
  bands: UsageBand[];
  costUsd: number;
  priced: boolean;
  tokens?: number;
  calls?: number;
}

export interface UsageReport {
  totalUsd: number;
  mainUsd: number;
  subagentUsd: number;
  otherUsd: number;
  models: UsageRow[];
  /** Per model, matched to `models` by label. */
  subagents: UsageRow[];
  /** Indirect usage (compaction, titles, …). */
  other: UsageRow[];
  /** "Some models have no pricing", "Pricing lookup failed", … */
  notes: string[];
}
