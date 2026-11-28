import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import { id, createdAt, ms, bool } from "./schema.columns";
import { bots } from "./schema";
import type { AutofixStatus } from "../../shared/machines/autofix";
import type { AutofixPassStatus } from "../../shared/machines/autofix-pass";
import type { RunStatus } from "../../shared/machines/run";
import type { HandoffStatus } from "../../shared/machines/handoff";

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
