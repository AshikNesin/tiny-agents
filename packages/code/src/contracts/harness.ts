/**
 * The adapter contract. One `HarnessInstance` per configured harness; the
 * app routes every Code page call and every bot hand-off through it by the
 * thread id's instance part, and never asks which kind of harness it is.
 *
 * Required methods are what every harness must do (list, read, watch,
 * start, send, stop, models). Optional methods are gated by
 * `capabilities()`: when a method is absent its capability is off.
 *
 * Every method takes the harness's own (native) thread id.
 */
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
  /** Shown in the UI: "Shelley", "Claude Code". */
  readonly label: string;

  capabilities(): Capabilities;
  /** Open long-lived connections (idempotent). */
  start(): void;
  stop(): void;
  /** Cheap and side-effect free: never opens a session or starts a login. */
  status(): InstanceStatus;
  subscribe(listener: (event: InstanceEvent) => void): () => void;

  // --- threads ---------------------------------------------------------------
  listThreads(view: "active" | "archived"): Promise<ThreadSummary[]>;
  searchThreads?(query: string, archived: boolean): Promise<ThreadSummary[]>;
  getThread(nativeId: string): Promise<ThreadSnapshot>;
  /** First event is a `snapshot`; then live changes until the returned stop. */
  watchThread(nativeId: string, listener: (event: ThreadEvent) => void): () => void;
  /** Where a conversation stands now (hand-offs, bot status, reconciling). */
  outcome(nativeId: string): Promise<TurnOutcome>;
  createThread(input: CreateThreadInput): Promise<{ nativeId: string }>;
  archive?(nativeId: string, archived: boolean): Promise<{ moved: string[] }>;
  remove?(nativeId: string): Promise<void>;
  rename?(nativeId: string, title: string): Promise<void>;
  changeCwd?(nativeId: string, cwd: string): Promise<void>;
  fork?(nativeId: string, at: string): Promise<{ nativeId: string }>;
  /** "Open in Shelley" and friends. */
  externalUrl?(thread: ThreadSummary): string | undefined;

  // --- turns -----------------------------------------------------------------
  send(nativeId: string, input: SendInput): Promise<{ status: "accepted" | "queued" }>;
  interrupt(nativeId: string): Promise<void>;
  respond?(nativeId: string, requestId: string, answer: RequestAnswer): Promise<void>;
  recover?(nativeId: string, action: RecoveryAction): Promise<void>;
  queued?(nativeId: string, action: "send" | "cancel", queuedId: string): Promise<void>;
  killJob?(nativeId: string, jobId: string): Promise<void>;
  updateSettings?(nativeId: string, change: Partial<ThreadSettings>): Promise<ThreadSettings>;
  usage?(nativeId: string): Promise<UsageReport>;

  // --- composer and workspace ------------------------------------------------
  models(): Promise<ModelOption[]>;
  commands?(): SlashCommand[];
  skills?(cwd: string, nativeId?: string): Promise<Skill[]>;
  findFiles?(dir: string, query: string, content?: "only"): Promise<FileMatch[]>;
  /** Store an attachment; answers the ref to pass in `attachments`. */
  upload?(file: Blob, filename: string): Promise<{ ref: string }>;
  browse?(path?: string): Promise<DirectoryListing>;
  validateCwd?(path: string): Promise<{ valid: boolean; error?: string }>;
  repos?(): Promise<Array<{ path: string; name?: string }>>;
  createWorktree?(cwd: string): Promise<{ path: string }>;
  diffs?(cwd: string): Promise<{ diffs: GitDiff[]; gitRoot: string }>;
  diffFiles?(cwd: string, diffId: string): Promise<GitFile[]>;
  fileDiff?(cwd: string, diffId: string, path: string): Promise<GitFileDiff>;
  /** Serve an asset ref (an image, an uploaded file). */
  asset?(ref: string): Promise<Response>;
}

/** What the app gives drivers: logging and a small durable thread index. */
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

/**
 * The app's thread index (`code_threads`), for drivers whose harness keeps
 * no list of its own (Claude Code). Rows are pointers and metadata, never
 * transcripts. `data` is driver-private JSON.
 */
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
