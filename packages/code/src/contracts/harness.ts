import type { Capabilities, RecoveryAction } from "./capabilities";
import type { InstanceEvent, InstanceStatus, ThreadEvent } from "./events";
import type { HarnessKind, InstanceId } from "./ids";
import type { RequestAnswer } from "./items";
import type {
  CreateThreadInput,
  DirectoryListing,
  FileMatch,
  GitDiff,
  GitFile,
  GitFileDiff,
  ModelOption,
  SendInput,
  Skill,
  SlashCommand,
  ThreadSettings,
  ThreadSnapshot,
  ThreadSummary,
  TurnOutcome,
  UsageReport,
} from "./threads";

export interface HarnessInstance {
  readonly id: InstanceId;
  readonly kind: HarnessKind;
  readonly label: string;

  capabilities(): Capabilities;
  start(): void;
  stop(): void;
  status(): InstanceStatus;
  subscribe(listener: (event: InstanceEvent) => void): () => void;

  listThreads(view: "active" | "archived"): Promise<ThreadSummary[]>;
  searchThreads?(query: string, archived: boolean): Promise<ThreadSummary[]>;
  getThread(nativeId: string): Promise<ThreadSnapshot>;
  watchThread(nativeId: string, listener: (event: ThreadEvent) => void): () => void;
  outcome(nativeId: string): Promise<TurnOutcome>;
  createThread(input: CreateThreadInput): Promise<{ nativeId: string }>;
  archive?(nativeId: string, archived: boolean): Promise<{ moved: string[] }>;
  remove?(nativeId: string): Promise<void>;
  rename?(nativeId: string, title: string): Promise<void>;
  changeCwd?(nativeId: string, cwd: string): Promise<void>;
  fork?(nativeId: string, at: string): Promise<{ nativeId: string }>;
  externalUrl?(thread: ThreadSummary): string | undefined;

  send(nativeId: string, input: SendInput): Promise<{ status: "accepted" | "queued" }>;
  interrupt(nativeId: string): Promise<void>;
  respond?(nativeId: string, requestId: string, answer: RequestAnswer): Promise<void>;
  recover?(nativeId: string, action: RecoveryAction): Promise<void>;
  queued?(nativeId: string, action: "send" | "cancel", queuedId: string): Promise<void>;
  killJob?(nativeId: string, jobId: string): Promise<void>;
  updateSettings?(nativeId: string, change: Partial<ThreadSettings>): Promise<ThreadSettings>;
  usage?(nativeId: string): Promise<UsageReport>;

  models(): Promise<ModelOption[]>;
  commands?(): SlashCommand[];
  skills?(cwd: string, nativeId?: string): Promise<Skill[]>;
  findFiles?(dir: string, query: string, content?: "only"): Promise<FileMatch[]>;
  upload?(file: Blob, filename: string): Promise<{ ref: string }>;
  browse?(path?: string): Promise<DirectoryListing>;
  validateCwd?(path: string): Promise<{ valid: boolean; error?: string }>;
  repos?(): Promise<Array<{ path: string; name?: string }>>;
  createWorktree?(cwd: string): Promise<{ path: string }>;
  diffs?(cwd: string): Promise<{ diffs: GitDiff[]; gitRoot: string }>;
  diffFiles?(cwd: string, diffId: string): Promise<GitFile[]>;
  fileDiff?(cwd: string, diffId: string, path: string): Promise<GitFileDiff>;
  changeStamp?(cwd: string): Promise<string>;
  asset?(ref: string): Promise<Response>;
}

export interface HarnessHost {
  logger: HarnessLogger;
  index: ThreadIndex;
  now(): Date;
}

export interface HarnessLogger {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export interface IndexedThread {
  instanceId: InstanceId;
  nativeId: string;
  title: string;
  cwd: string | null;
  parentNativeId: string | null;
  model: string | null;
  effort: string | null;
  permissionMode: string | null;
  archived: boolean;
  createdAt: Date;
  updatedAt: Date;
  data: Record<string, unknown>;
}

export interface ThreadIndex {
  list(instanceId: InstanceId): Promise<IndexedThread[]>;
  get(instanceId: InstanceId, nativeId: string): Promise<IndexedThread | undefined>;
  upsert(
    row: Pick<IndexedThread, "instanceId" | "nativeId"> & Partial<IndexedThread>,
  ): Promise<IndexedThread>;
  remove(instanceId: InstanceId, nativeId: string): Promise<void>;
}
