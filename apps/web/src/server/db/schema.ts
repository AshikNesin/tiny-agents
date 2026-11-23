import { relations, sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  unique,
  uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import { timestamps, users } from "@groot/core/database/schema";
import { createId } from "@groot/core/utils/id.utils";
import type { ExtractStatus } from "../../shared/machines/extraction";
import type { AutofixStatus } from "../../shared/machines/autofix";
import type { AutofixPassStatus } from "../../shared/machines/autofix-pass";
import type { RunStatus } from "../../shared/machines/run";
import type { HandoffStatus } from "../../shared/machines/handoff";
import type { MemoryStatus } from "../../shared/machines/memory";
import type { PushSubscriptionStatus } from "../../shared/machines/push-subscription";
import type { RoutineRunStatus } from "../../shared/machines/routine-run";
import type { TaskStatus } from "../../shared/machines/task";
import type { RoutineTrigger } from "../../shared/api/routines";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => createId());

const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date());

const ms = (name: string) => integer(name, { mode: "timestamp_ms" });
const bool = (name: string) => integer(name, { mode: "boolean" });

export const tasks = sqliteTable(
  "tasks",
  {
    id: id(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    status: text("status").$type<TaskStatus>().notNull().default("todo"),
    priority: text("priority").notNull().default("medium"),
    dueAt: ms("due_at"),
    completedAt: ms("completed_at"),
    sourceKey: text("source_key").unique(),
    ...timestamps,
  },
  (t) => [index("tasks_status_due_at_idx").on(t.status, t.dueAt)],
);

export const bots = sqliteTable("bots", {
  id: id(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  systemPrompt: text("system_prompt").notNull().default(""),
  modelId: text("model_ref").references((): AnySQLiteColumn => models.id, {
    onDelete: "restrict",
  }),
  conversationId: text("conversation_id").notNull().unique(),
  chatStartedAt: ms("chat_started_at")
    .notNull()
    .$defaultFn(() => new Date()),
  lastReadAt: ms("last_read_at"),
  lastActivityAt: ms("last_activity_at")
    .notNull()
    .$defaultFn(() => new Date()),
  lastMessagePreview: text("last_message_preview"),
  toolPermissions: text("tool_permissions").notNull().default("{}"),
  memoryEnabled: bool("memory_enabled").notNull().default(true),
  autoReview: bool("auto_review").notNull().default(false),
  yoloByDefault: bool("yolo_by_default").notNull().default(false),
  memoryCapturedThrough: ms("memory_captured_through"),
  memoryTidiedAt: ms("memory_tidied_at"),
  pinnedAt: ms("pinned_at"),
  browserProfile: text("browser_profile").$type<"shared" | "own">().notNull().default("shared"),
  ...timestamps,
});

export const botReleases = sqliteTable(
  "bot_releases",
  {
    botId: text("bot_id").notNull(),
    resource: text("resource").notNull(),
    captured: text("captured").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.botId, t.resource] })],
);

export const botChats = sqliteTable(
  "bot_chats",
  {
    id: id(),
    botId: text("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id").notNull().unique(),
    startedAt: ms("started_at").notNull(),
    endedAt: ms("ended_at").notNull(),
    title: text("title"),
    lastMessagePreview: text("last_message_preview"),
    messageCount: integer("message_count").notNull().default(0),
  },
  (t) => [index("bot_chats_bot_id_ended_at_idx").on(t.botId, t.endedAt)],
);

export const skills = sqliteTable("skills", {
  id: id(),
  name: text("name").notNull().unique(),
  description: text("description").notNull(),
  body: text("body").notNull(),
  files: text("files").notNull().default("[]"),
  source: text("source").notNull().default("manual"),
  sourceUrl: text("source_url"),
  ...timestamps,
});

export const botMessages = sqliteTable(
  "bot_messages",
  {
    id: id(),
    fromBotId: text("from_bot_id").references(() => bots.id, { onDelete: "cascade" }),
    toBotId: text("to_bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id"),
    ownConversation: bool("own_conversation").notNull().default(false),
    replyToBotId: text("reply_to_bot_id").references(() => bots.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    requestId: text("request_id").notNull().unique(),
    sourceKey: text("source_key").unique(),
    text: text("text").notNull(),
    deliveredAt: ms("delivered_at"),
    answeredAt: ms("answered_at"),
    answerReplyAt: ms("answer_reply_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("bot_messages_to_bot_id_answered_at_idx").on(t.toBotId, t.answeredAt),
    index("bot_messages_reply_to_bot_id_answered_at_idx").on(t.replyToBotId, t.answeredAt),
  ],
);

export const codeThreads = sqliteTable(
  "code_threads",
  {
    id: text("id").primaryKey(),
    instanceId: text("instance_id").notNull(),
    nativeId: text("native_id").notNull(),
    title: text("title").notNull().default(""),
    cwd: text("cwd"),
    parentNativeId: text("parent_native_id"),
    model: text("model"),
    effort: text("effort"),
    permissionMode: text("permission_mode"),
    archived: bool("archived").notNull().default(false),
    followed: bool("followed").notNull().default(false),
    seenCursor: integer("seen_cursor").notNull().default(0),
    data: text("data").notNull().default("{}"),
    projectId: text("project_id").references((): AnySQLiteColumn => codeProjects.id, {
      onDelete: "set null",
    }),
    branch: text("branch"),
    baseSha: text("base_sha"),
    worktree: text("worktree"),
    role: text("role").$type<"work" | "review">().notNull().default("work"),
    attention: text("attention"),
    createdAt: createdAt(),
    updatedAt: ms("updated_at")
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("code_threads_instance_idx").on(t.instanceId, t.updatedAt),
    index("code_threads_project_idx").on(t.projectId),
    uniqueIndex("code_threads_native_idx").on(t.instanceId, t.nativeId),
  ],
);

export const codeRuns = sqliteTable(
  "code_runs",
  {
    id: id(),
    threadId: text("thread_id")
      .notNull()
      .references((): AnySQLiteColumn => codeThreads.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    trigger: text("trigger").$type<"owner" | "workflow" | "bot">().notNull(),
    workflow: text("workflow"),
    event: text("event").notNull().default("{}"),
    status: text("status").$type<RunStatus>().notNull(),
    checkpointSeq: integer("checkpoint_seq"),
    report: text("report"),
    costUsd: real("cost_usd"),
    startedAt: ms("started_at")
      .notNull()
      .$defaultFn(() => new Date()),
    endedAt: ms("ended_at"),
  },
  (t) => [uniqueIndex("code_runs_seq_idx").on(t.threadId, t.seq)],
);

export const codeProjects = sqliteTable(
  "code_projects",
  {
    id: id(),
    name: text("name").notNull(),
    repoOwner: text("repo_owner").notNull(),
    repoName: text("repo_name").notNull(),
    transport: text("transport").$type<"gh" | "app">().notNull().default("gh"),
    baseBranch: text("base_branch").notNull(),
    checkoutPath: text("checkout_path").notNull(),
    installationId: integer("installation_id"),
    defaultInstanceId: text("default_instance_id"),
    defaultModel: text("default_model"),
    settings: text("settings").notNull().default("{}"),
    createdAt: createdAt(),
    updatedAt: ms("updated_at")
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [uniqueIndex("code_projects_repo_idx").on(t.repoOwner, t.repoName)],
);

export const codePullRequests = sqliteTable(
  "code_pull_requests",
  {
    id: id(),
    threadId: text("thread_id").notNull(),
    projectId: text("project_id")
      .notNull()
      .references(() => codeProjects.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    url: text("url").notNull(),
    title: text("title").notNull().default(""),
    headRef: text("head_ref").notNull(),
    headSha: text("head_sha"),
    baseRef: text("base_ref").notNull(),
    state: text("state").$type<"open" | "closed" | "merged">().notNull().default("open"),
    draft: bool("draft").notNull().default(true),
    snapshot: text("snapshot"),
    syncedAt: ms("synced_at"),
    autofix: bool("autofix").notNull().default(false),
    loopStatus: text("loop_status").$type<AutofixStatus>().notNull().default("off"),
    loopReason: text("loop_reason"),
    loopChangedAt: ms("loop_changed_at"),
    loopHeadSha: text("loop_head_sha"),
    passesWithoutOwner: integer("passes_without_owner").notNull().default(0),
    ownerInputAt: ms("owner_input_at"),
    pendingJobId: text("pending_job_id"),
    stalledNotifiedSha: text("stalled_notified_sha"),
    yoloMethod: text("yolo_method").$type<"merge" | "squash" | "rebase">(),
    yoloWaiting: text("yolo_waiting"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("code_pull_requests_number_idx").on(t.projectId, t.number),
    uniqueIndex("code_pull_requests_open_idx")
      .on(t.threadId)
      .where(sql`state = 'open'`),
    index("code_pull_requests_thread_idx").on(t.threadId, t.createdAt),
  ],
);

export const codePrComments = sqliteTable("code_pr_comments", {
  id: integer("id").primaryKey(),
  pullId: text("pull_id")
    .notNull()
    .references(() => codePullRequests.id, { onDelete: "cascade" }),
  passId: text("pass_id"),
  createdAt: createdAt(),
});

export const codeAutofixPasses = sqliteTable(
  "code_autofix_passes",
  {
    id: id(),
    pullId: text("pull_id")
      .notNull()
      .references(() => codePullRequests.id, { onDelete: "cascade" }),
    trigger: text("trigger").notNull(),
    stateHash: text("state_hash").notNull(),
    items: text("items").notNull().default("[]"),
    status: text("status").$type<AutofixPassStatus>().notNull(),
    startSha: text("start_sha"),
    pushedSha: text("pushed_sha"),
    startCostUsd: real("start_cost_usd"),
    costUsd: real("cost_usd"),
    outcome: text("outcome"),
    detail: text("detail"),
    createdAt: createdAt(),
    startedAt: ms("started_at"),
    finishedAt: ms("finished_at"),
  },
  (t) => [
    uniqueIndex("code_autofix_passes_hash_idx").on(t.pullId, t.stateHash),
    index("code_autofix_passes_pull_idx").on(t.pullId, t.createdAt),
  ],
);

export const codeCheckpoints = sqliteTable(
  "code_checkpoints",
  {
    id: id(),
    threadId: text("thread_id").notNull(),
    seq: integer("seq").notNull(),
    sha: text("sha").notNull(),
    headSha: text("head_sha").notNull(),
    reason: text("reason").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("code_checkpoints_seq_idx").on(t.threadId, t.seq)],
);

export const codePrEvents = sqliteTable("code_pr_events", {
  deliveryId: text("delivery_id").primaryKey(),
  event: text("event").notNull(),
  pullId: text("pull_id"),
  receivedAt: createdAt(),
});

export const codeReviewViewed = sqliteTable(
  "code_review_viewed",
  {
    threadId: text("thread_id").notNull(),
    path: text("path").notNull(),
    contentHash: text("content_hash").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.threadId, t.path] })],
);

export const codeReviewDrafts = sqliteTable(
  "code_review_drafts",
  {
    id: id(),
    threadId: text("thread_id").notNull(),
    path: text("path").notNull(),
    side: text("side").$type<"old" | "new">().notNull().default("new"),
    startLine: integer("start_line").notNull(),
    endLine: integer("end_line").notNull(),
    quote: text("quote").notNull().default(""),
    body: text("body").notNull(),
    target: text("target").$type<"agent" | "github">().notNull().default("agent"),
    createdAt: createdAt(),
    sentAt: ms("sent_at"),
  },
  (t) => [index("code_review_drafts_thread_idx").on(t.threadId, t.sentAt)],
);

export const codeFindings = sqliteTable(
  "code_findings",
  {
    id: id(),
    reviewId: text("review_id")
      .notNull()
      .references((): AnySQLiteColumn => codeReviews.id, { onDelete: "cascade" }),
    severity: text("severity").$type<"bug" | "test" | "nit" | "question">().notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    path: text("path").notNull(),
    line: integer("line").notNull(),
    state: text("state").$type<"open" | "added" | "dismissed">().notNull().default("open"),
    headSha: text("head_sha").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("code_findings_review_idx").on(t.reviewId, t.state)],
);

export const codeReviews = sqliteTable(
  "code_reviews",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => codeProjects.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    url: text("url").notNull(),
    title: text("title").notNull().default(""),
    author: text("author").notNull().default(""),
    headRef: text("head_ref").notNull(),
    baseRef: text("base_ref").notNull(),
    headSha: text("head_sha").notNull(),
    fromFork: bool("from_fork").notNull().default(false),
    mine: bool("mine").notNull().default(false),
    reviewedSha: text("reviewed_sha"),
    worktree: text("worktree"),
    threadId: text("thread_id"),
    brief: text("brief"),
    reviewingSince: ms("reviewing_since"),
    archivedAt: ms("archived_at"),
    createdAt: createdAt(),
    updatedAt: ms("updated_at")
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex("code_reviews_pull_idx").on(t.projectId, t.number),
    index("code_reviews_thread_idx").on(t.threadId),
  ],
);

export const codeHandoffs = sqliteTable(
  "code_handoffs",
  {
    id: id(),
    botId: text("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    threadId: text("thread_id"),
    title: text("title"),
    task: text("task").notNull(),
    cwd: text("cwd"),
    conversationId: text("conversation_id"),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    status: text("status").$type<HandoffStatus>().notNull(),
    createdAt: createdAt(),
    finishedAt: ms("finished_at"),
  },
  (t) => [
    index("code_handoffs_thread_idx").on(t.threadId),
    index("code_handoffs_bot_idx").on(t.botId, t.createdAt),
  ],
);

export const codeHandoffFinishes = sqliteTable(
  "code_handoff_finishes",
  {
    id: id(),
    handoffId: text("handoff_id")
      .notNull()
      .references(() => codeHandoffs.id, { onDelete: "cascade" }),
    requestId: text("request_id").notNull().unique(),
    harness: text("harness").notNull(),
    text: text("text").notNull(),
    createdAt: createdAt(),
    deliveredAt: ms("delivered_at"),
  },
  (t) => [index("code_handoff_finishes_delivered_idx").on(t.deliveredAt)],
);

export const botSkills = sqliteTable(
  "bot_skills",
  {
    botId: text("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    skillId: text("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.botId, t.skillId] }),
    index("bot_skills_skill_id_idx").on(t.skillId),
  ],
);

export const connections = sqliteTable("connections", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  url: text("url").notNull(),
  transport: text("transport").notNull().default("streamable-http"),
  authType: text("auth_type").notNull().default("none"),
  headerName: text("header_name"),
  secretEnc: text("secret_enc"),
  oauthEnc: text("oauth_enc"),
  toolsCache: text("tools_cache").notNull().default("[]"),
  disabledTools: text("disabled_tools").notNull().default("[]"),
  secretRef: text("secret_ref"),
  secretItemId: text("secret_item_id"),
  ...timestamps,
});

export const botConnections = sqliteTable(
  "bot_connections",
  {
    botId: text("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    connectionId: text("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.botId, t.connectionId] }),
    index("bot_connections_connection_id_idx").on(t.connectionId),
  ],
);

export const vaultItems = sqliteTable("vault_items", {
  id: id(),
  handle: text("handle").notNull().unique(),
  kind: text("kind").notNull(),
  backend: text("backend").notNull(),
  audience: text("audience").notNull().default("bots"),
  externalId: text("external_id").notNull(),
  field: text("field"),
  label: text("label").notNull(),
  username: text("username"),
  originsJson: text("origins_json").notNull().default("[]"),
  hostsJson: text("hosts_json").notNull().default("[]"),
  injectJson: text("inject_json"),
  toolsJson: text("tools_json").notNull().default("[]"),
  botsJson: text("bots_json"),
  approval: text("approval").notNull().default("per_conversation"),
  allowUnattended: bool("allow_unattended").notNull().default(false),
  whenToUse: text("when_to_use"),
  cardMetaJson: text("card_meta_json"),
  hasTotp: bool("has_totp").notNull().default(false),
  disabled: bool("disabled").notNull().default(false),
  lastUsedAt: ms("last_used_at"),
  lastUsedBy: text("last_used_by"),
  ...timestamps,
});

export const vaultValues = sqliteTable("vault_values", {
  id: text("id").primaryKey(),
  sealed: text("sealed").notNull(),
  policy: text("policy").notNull().default(""),
  ...timestamps,
});

export const providers = sqliteTable("providers", {
  id: id(),
  name: text("name").notNull(),
  kind: text("kind").notNull(),
  baseUrl: text("base_url"),
  credentialItemId: text("credential_item_id").references(() => vaultItems.id, {
    onDelete: "restrict",
  }),
  credentialHint: text("credential_hint"),
  viaProviderId: text("via_provider_id").references((): AnySQLiteColumn => providers.id, {
    onDelete: "restrict",
  }),
  settingsJson: text("settings_json").notNull().default("{}"),
  discovery: text("discovery").notNull().default("auto"),
  allowPrivateNetwork: bool("allow_private_network").notNull().default(false),
  enabled: bool("enabled").notNull().default(true),
  status: text("status").notNull().default("unchecked"),
  statusDetail: text("status_detail"),
  checkedAt: ms("checked_at"),
  version: integer("version").notNull().default(1),
  ...timestamps,
});

export const models = sqliteTable(
  "models",
  {
    id: id(),
    providerId: text("provider_id")
      .notNull()
      .references(() => providers.id, { onDelete: "cascade" }),
    upstreamId: text("upstream_id").notNull(),
    name: text("name").notNull(),
    type: text("type").notNull().default("chat"),
    source: text("source").notNull(),
    enabled: bool("enabled").notNull().default(true),
    contextWindow: integer("context_window").notNull(),
    maxOutputTokens: integer("max_output_tokens").notNull(),
    imageInput: bool("image_input").notNull(),
    reasoning: bool("reasoning").notNull(),
    overridesJson: text("overrides_json").notNull().default("{}"),
    compatJson: text("compat_json"),
    missingSince: ms("missing_since"),
    ...timestamps,
  },
  (t) => [uniqueIndex("models_provider_upstream_idx").on(t.providerId, t.upstreamId)],
);

export const modelRoles = sqliteTable("model_roles", {
  role: text("role").primaryKey(),
  modelId: text("model_id")
    .notNull()
    .references(() => models.id, { onDelete: "restrict" }),
  ...timestamps,
});

export const vaultAuditEvents = sqliteTable(
  "vault_audit_events",
  {
    id: id(),
    at: ms("at")
      .notNull()
      .$defaultFn(() => new Date()),
    itemId: text("item_id").references(() => vaultItems.id, { onDelete: "set null" }),
    handle: text("handle").notNull(),
    botId: text("bot_id"),
    conversationId: integer("conversation_id"),
    taskId: integer("task_id"),
    tool: text("tool").notNull(),
    target: text("target").notNull(),
    outcome: text("outcome").notNull(),
    reason: text("reason"),
    unattended: bool("unattended").notNull().default(false),
  },
  (t) => [
    index("vault_audit_events_item_id_at_idx").on(t.itemId, t.at),
    index("vault_audit_events_at_idx").on(t.at),
  ],
);

export const uploads = sqliteTable("uploads", {
  id: id(),
  kind: text("kind").notNull(),
  name: text("name").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  width: integer("width"),
  height: integer("height"),
  modelKey: text("model_key"),
  storageKey: text("storage_key").notNull().unique(),
  uploadedBy: integer("uploaded_by"),
  botId: text("bot_id"),
  createdAt: createdAt(),
  sha256: text("sha256"),
  extractStatus: text("extract_status").$type<ExtractStatus>().notNull().default("none"),
  extractError: text("extract_error"),
  extractMeta: text("extract_meta"),
  extractedAt: ms("extracted_at"),
});

export const routines = sqliteTable(
  "routines",
  {
    id: id(),
    botId: text("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    prompt: text("prompt").notNull(),
    schedule: text("schedule", { mode: "json" }).$type<unknown>().notNull(),
    enabled: bool("enabled").notNull().default(true),
    nextRunAt: ms("next_run_at"),
    pendingJobId: text("pending_job_id").unique(),
    sourceKey: text("source_key").unique(),
    conversationId: text("conversation_id").unique(),
    blockedStreak: integer("blocked_streak").notNull().default(0),
    pausedReason: text("paused_reason"),
    hookTokenHash: text("hook_token_hash").unique(),
    progress: text("progress"),
    ...timestamps,
  },
  (t) => [index("routines_enabled_next_run_at_idx").on(t.enabled, t.nextRunAt)],
);

export const memories = sqliteTable(
  "memories",
  {
    id: id(),
    botId: text("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    category: text("category").notNull(),
    status: text("status").$type<MemoryStatus>().notNull().default("active"),
    source: text("source").notNull().default("capture"),
    until: ms("until"),
    conversationId: text("conversation_id"),
    supersededById: text("superseded_by_id"),
    supersededAt: ms("superseded_at"),
    ...timestamps,
  },
  (t) => [index("memories_bot_id_status_category_idx").on(t.botId, t.status, t.category)],
);

export const promptRevisions = sqliteTable(
  "prompt_revisions",
  {
    id: id(),
    botId: text("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    prompt: text("prompt").notNull(),
    source: text("source").notNull(),
    ...timestamps,
  },
  (t) => [index("prompt_revisions_bot_id_created_at_idx").on(t.botId, t.createdAt)],
);

export const routineRuns = sqliteTable(
  "routine_runs",
  {
    id: id(),
    routineId: text("routine_id")
      .notNull()
      .references(() => routines.id, { onDelete: "cascade" }),
    scheduledFor: ms("scheduled_for").notNull(),
    status: text("status").$type<RoutineRunStatus>().notNull(),
    trigger: text("trigger").$type<RoutineTrigger>().notNull().default("schedule"),
    requestId: text("request_id").notNull().unique(),
    submittedAt: ms("submitted_at"),
    startedAt: ms("started_at"),
    finishedAt: ms("finished_at"),
    output: text("output"),
    error: text("error"),
    conversationId: text("conversation_id"),
    tokens: integer("tokens"),
    messages: integer("messages"),
  },
  (t) => [
    unique("routine_runs_routine_id_scheduled_for_unique").on(t.routineId, t.scheduledFor),
    index("routine_runs_status_idx").on(t.status),
    index("routine_runs_conversation_id_idx").on(t.conversationId),
  ],
);

export const routineEvents = sqliteTable(
  "routine_events",
  {
    id: id(),
    routineId: text("routine_id")
      .notNull()
      .references(() => routines.id, { onDelete: "cascade" }),
    deliveryId: text("delivery_id").notNull(),
    payload: text("payload").notNull(),
    receivedAt: ms("received_at").notNull(),
    runId: text("run_id"),
  },
  (t) => [
    unique("routine_events_routine_id_delivery_id_unique").on(t.routineId, t.deliveryId),
    index("routine_events_routine_id_run_id_idx").on(t.routineId, t.runId),
  ],
);

export const guests = sqliteTable("guests", {
  userId: integer("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
});

export const botGuests = sqliteTable(
  "bot_guests",
  {
    botId: text("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    lastReadAt: ms("last_read_at"),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.botId, t.userId] }),
    index("bot_guests_user_id_idx").on(t.userId),
  ],
);

export const pushSubscriptions = sqliteTable(
  "push_subscriptions",
  {
    id: id(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull().unique(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    distributor: text("distributor").$type<"fcm" | "unifiedpush" | "browser">().notNull(),
    label: text("label").notNull().default(""),
    appVersion: text("app_version"),
    status: text("status").$type<PushSubscriptionStatus>().notNull().default("active"),
    failureCount: integer("failure_count").notNull().default(0),
    lastError: text("last_error"),
    lastSuccessAt: ms("last_success_at"),
    createdAt: createdAt(),
    lastSeenAt: ms("last_seen_at")
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index("push_subscriptions_user_id_idx").on(t.userId)],
);

export const llmCalls = sqliteTable(
  "llm_calls",
  {
    id: id(),
    purpose: text("purpose").notNull(),
    botId: text("bot_id").references(() => bots.id, { onDelete: "cascade" }),
    modelId: text("model_id"),
    provider: text("provider"),
    model: text("model"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    costUsd: real("cost_usd").notNull().default(0),
    durationMs: integer("duration_ms"),
    outcome: text("outcome").$type<"ok" | "error" | "timeout" | "aborted">().notNull(),
    error: text("error"),
    createdAt: createdAt(),
  },
  (t) => [index("llm_calls_created_at_idx").on(t.createdAt)],
);

export * from "@groot/core/notification/notification.schema";

export const botsRelations = relations(bots, ({ many }) => ({
  skills: many(botSkills),
  connections: many(botConnections),
  messagesFrom: many(botMessages, { relationName: "messagesFrom" }),
  messagesTo: many(botMessages, { relationName: "messagesTo" }),
  answersFor: many(botMessages, { relationName: "answersFor" }),
  routines: many(routines),
  memories: many(memories),
  pastChats: many(botChats),
  guests: many(botGuests),
}));

export const botGuestsRelations = relations(botGuests, ({ one }) => ({
  bot: one(bots, { fields: [botGuests.botId], references: [bots.id] }),
  user: one(users, { fields: [botGuests.userId], references: [users.id] }),
}));

export const botChatsRelations = relations(botChats, ({ one }) => ({
  bot: one(bots, { fields: [botChats.botId], references: [bots.id] }),
}));

export const skillsRelations = relations(skills, ({ many }) => ({
  bots: many(botSkills),
}));

export const botSkillsRelations = relations(botSkills, ({ one }) => ({
  bot: one(bots, { fields: [botSkills.botId], references: [bots.id] }),
  skill: one(skills, { fields: [botSkills.skillId], references: [skills.id] }),
}));

export const connectionsRelations = relations(connections, ({ many }) => ({
  bots: many(botConnections),
}));

export const botConnectionsRelations = relations(botConnections, ({ one }) => ({
  bot: one(bots, { fields: [botConnections.botId], references: [bots.id] }),
  connection: one(connections, {
    fields: [botConnections.connectionId],
    references: [connections.id],
  }),
}));

export const botMessagesRelations = relations(botMessages, ({ one }) => ({
  bot: one(bots, {
    fields: [botMessages.fromBotId],
    references: [bots.id],
    relationName: "messagesFrom",
  }),
  to: one(bots, {
    fields: [botMessages.toBotId],
    references: [bots.id],
    relationName: "messagesTo",
  }),
  replyTo: one(bots, {
    fields: [botMessages.replyToBotId],
    references: [bots.id],
    relationName: "answersFor",
  }),
}));

export const vaultItemsRelations = relations(vaultItems, ({ many }) => ({
  events: many(vaultAuditEvents),
}));

export const vaultAuditEventsRelations = relations(vaultAuditEvents, ({ one }) => ({
  item: one(vaultItems, { fields: [vaultAuditEvents.itemId], references: [vaultItems.id] }),
}));

export const routinesRelations = relations(routines, ({ one, many }) => ({
  bot: one(bots, { fields: [routines.botId], references: [bots.id] }),
  runs: many(routineRuns),
}));

export const llmCallsRelations = relations(llmCalls, ({ one }) => ({
  bot: one(bots, { fields: [llmCalls.botId], references: [bots.id] }),
}));

export const routineRunsRelations = relations(routineRuns, ({ one }) => ({
  routine: one(routines, { fields: [routineRuns.routineId], references: [routines.id] }),
}));

export const memoriesRelations = relations(memories, ({ one, many }) => ({
  bot: one(bots, { fields: [memories.botId], references: [bots.id] }),
  supersededBy: one(memories, {
    fields: [memories.supersededById],
    references: [memories.id],
    relationName: "supersession",
  }),
  superseding: many(memories, { relationName: "supersession" }),
}));

export type Task = typeof tasks.$inferSelect;
export type Bot = typeof bots.$inferSelect;
export type BotChat = typeof botChats.$inferSelect;
export type Skill = typeof skills.$inferSelect;
export type BotMessage = typeof botMessages.$inferSelect;
export type BotSkill = typeof botSkills.$inferSelect;
export type Connection = typeof connections.$inferSelect;
export type BotConnection = typeof botConnections.$inferSelect;
export type VaultItem = typeof vaultItems.$inferSelect;
export type VaultAuditEvent = typeof vaultAuditEvents.$inferSelect;
export type VaultValue = typeof vaultValues.$inferSelect;
export type Upload = typeof uploads.$inferSelect;
export type Routine = typeof routines.$inferSelect;
export type Memory = typeof memories.$inferSelect;
export type RoutineRun = typeof routineRuns.$inferSelect;
export type LlmCall = typeof llmCalls.$inferSelect;
export type CodeThreadRow = typeof codeThreads.$inferSelect;
export type CodeRunRow = typeof codeRuns.$inferSelect;
export type CodeFindingRow = typeof codeFindings.$inferSelect;
export type CodeHandoff = typeof codeHandoffs.$inferSelect;
export type CodeProjectRow = typeof codeProjects.$inferSelect;
export type CodeReviewRow = typeof codeReviews.$inferSelect;
export type CodePullRow = typeof codePullRequests.$inferSelect;
export type CodeAutofixPass = typeof codeAutofixPasses.$inferSelect;
export type CodeReviewDraft = typeof codeReviewDrafts.$inferSelect;
export type CodeCheckpoint = typeof codeCheckpoints.$inferSelect;
export type BotGuest = typeof botGuests.$inferSelect;
export type ProviderRow = typeof providers.$inferSelect;
export type ModelRowRecord = typeof models.$inferSelect;

export * from "@groot/core/database/schema";
export * from "@groot/jobs/server/schema";
