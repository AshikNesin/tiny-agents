import type { HarnessKind, InstanceId, ThreadId } from "./ids";
import type { TranscriptItem } from "./items";

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
  cursor: number;
  preview?: string;
  subagentCount?: number;
  runningJobs?: number;
  queuedCount?: number;
  turnInterrupted?: boolean;
  repoRoot?: string | null;
  gitCommit?: string | null;
  gitSubject?: string | null;
  permissionMode?: PermissionMode | null;
  externalUrl?: string;
  followed?: boolean;
  unread?: boolean;
  projectId?: string | null;
  pr?: { number: number; loop: string; url: string } | null;
  review?: { id: string; number: number } | null;
  role?: "work" | "review";
  branch?: string | null;
  status?: { group: "needs-you" | "working" | "review" | "done"; reason: string | null };
  offline?: boolean;
  startedBy?: { botId: string; name: string; project: boolean } | null;
}

export interface ThreadSettings {
  model: string | null;
  effort: string | null;
  permissionMode: PermissionMode | null;
}

export interface QueuedMessage {
  id: string;
  text: string;
  createdAt: string;
  from?: string;
}

export interface BackgroundJob {
  id: string;
  command: string;
  startedAt?: string;
}

export interface ThreadSnapshot {
  thread: ThreadSummary;
  items: TranscriptItem[];
  settings: ThreadSettings;
  queued: QueuedMessage[];
  jobs: BackgroundJob[];
  children: ThreadSummary[];
  context: { used: number; max?: number };
  costUsd: number;
}

export interface TurnOutcome {
  working: boolean;
  title: string;
  cwd: string | null;
  text: string;
  failed: boolean;
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
  attachments?: string[];
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
  binary?: boolean;
}

export interface GitFileDiff {
  path: string;
  oldContent: string;
  newContent: string;
  unshowable?: "binary" | "tooLarge";
}

export interface UsageBand {
  label: string;
  color: string;
  tokens: number;
  costUsd: number;
  unitPrice: number | null;
  priced: boolean;
  aggregate?: boolean;
}

export interface UsageRow {
  label: string;
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
  subagents: UsageRow[];
  other: UsageRow[];
  notes: string[];
}
