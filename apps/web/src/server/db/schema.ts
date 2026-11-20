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
import type { HandoffStatus } from "../../shared/machines/handoff";
import type { MemoryStatus } from "../../shared/machines/memory";
import type { PushSubscriptionStatus } from "../../shared/machines/push-subscription";
import type { RoutineRunStatus } from "../../shared/machines/routine-run";
import type { TaskStatus } from "../../shared/machines/task";

/**
 * App-owned tables. This file is the single schema entry point for
 * drizzle-kit (see `drizzle.config.ts`): it re-exports the core and jobs
 * tables so one migration history covers everything.
 *
 * Field names match the Prisma models they replace (camelCase in code,
 * snake_case columns), so the data copy from a pre-Drizzle database maps
 * column to field by name (see `./legacy-copy.ts`). Text ids keep the cuid
 * shape of the rows Prisma created.
 */

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
    /** Max 300 chars. */
    title: text("title").notNull(),
    /** Notes, max 2000 chars. */
    description: text("description").notNull().default(""),
    /** The task machine (shared/machines/task.ts). */
    status: text("status").$type<TaskStatus>().notNull().default("todo"),
    /** low | medium | high | urgent */
    priority: text("priority").notNull().default("medium"),
    dueAt: ms("due_at"),
    completedAt: ms("completed_at"),
    /** Tool-call id that created this task: exactly-once across pi-durable replays. */
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
  /**
   * The bot's model (issue #179): a reference, so a model in use can't be
   * deleted. Null: the bot runs on the `bot_default` model role.
   */
  modelId: text("model_ref").references((): AnySQLiteColumn => models.id, {
    onDelete: "restrict",
  }),
  conversationId: text("conversation_id").notNull().unique(),
  /** When the current chat conversation started (bot create, "New chat"). Routine run cards older than it stay out of the chat. */
  chatStartedAt: ms("chat_started_at")
    .notNull()
    .$defaultFn(() => new Date()),
  lastReadAt: ms("last_read_at"),
  lastActivityAt: ms("last_activity_at")
    .notNull()
    .$defaultFn(() => new Date()),
  lastMessagePreview: text("last_message_preview"),
  /** JSON object: tool name → "allow" | "ask" | "off"; tools without an entry use their default. */
  toolPermissions: text("tool_permissions").notNull().default("{}"),
  /** Memory capture + injection switch (issue #22). */
  memoryEnabled: bool("memory_enabled").notNull().default(true),
  /** Auto-review switch (issue #65): a classifier may approve "ask" tool calls. */
  autoReview: bool("auto_review").notNull().default(false),
  /** Every new chat of the bot starts with YOLO mode on (issue #151); routines never use it. */
  yoloByDefault: bool("yolo_by_default").notNull().default(false),
  /** Transcript watermark: owner turns captured through this instant (issue #22). */
  memoryCapturedThrough: ms("memory_captured_through"),
  /** Set when the owner pins the bot to the top of the sidebar; pinned bots sort by this, oldest first. */
  pinnedAt: ms("pinned_at"),
  /** "shared" (one browser, and its logins, for every such bot) or "own" (a browser of its own). */
  browserProfile: text("browser_profile").$type<"shared" | "own">().notNull().default("shared"),
  ...timestamps,
});

/**
 * Releases a deleted bot still owes (bot-resources.ts): written in the
 * transaction that deletes the bot row, each removed once its release
 * succeeds. What a crash or a sandbox outage left here runs again at boot.
 */
export const botReleases = sqliteTable(
  "bot_releases",
  {
    botId: text("bot_id").notNull(),
    resource: text("resource").notNull(),
    /** JSON, parsed by its entry's shape on every read: a later build may read it. */
    captured: text("captured").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.botId, t.resource] })],
);

/** Conversations a bot ran on before a "New chat" (past chats, issue #101). */
export const botChats = sqliteTable(
  "bot_chats",
  {
    id: id(),
    botId: text("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    /** The retired durable conversation in agent.db. */
    conversationId: text("conversation_id").notNull().unique(),
    /** The bot's chatStartedAt while this was its chat. */
    startedAt: ms("started_at").notNull(),
    /** When "New chat" (or continuing another past chat) retired it. */
    endedAt: ms("ended_at").notNull(),
    /** Short title: the first owner message until the title side-call replaces it. */
    title: text("title"),
    /** Bot.lastMessagePreview when it was retired. */
    lastMessagePreview: text("last_message_preview"),
    messageCount: integer("message_count").notNull().default(0),
  },
  (t) => [index("bot_chats_bot_id_ended_at_idx").on(t.botId, t.endedAt)],
);

export const skills = sqliteTable("skills", {
  id: id(),
  /** Agent Skills name: lowercase-with-hyphens, unique in the library. */
  name: text("name").notNull().unique(),
  description: text("description").notNull(),
  /** SKILL.md body (markdown, without frontmatter). */
  body: text("body").notNull(),
  /** JSON array of bundled files: [{ path, content }]. Text only; never executed. */
  files: text("files").notNull().default("[]"),
  /** manual | url | bot */
  source: text("source").notNull().default("manual"),
  sourceUrl: text("source_url"),
  ...timestamps,
});

export const botMessages = sqliteTable(
  "bot_messages",
  {
    id: id(),
    /** Sender bot id; null when the owner tagged the target in another bot's chat (a mention). */
    fromBotId: text("from_bot_id").references(() => bots.id, { onDelete: "cascade" }),
    /** Receiving bot. */
    toBotId: text("to_bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    /**
     * The target's conversation this message was submitted to: its answer is
     * read there even after the target starts a new chat. Null on rows from
     * before it was recorded (read from the target's current chat).
     */
    conversationId: text("conversation_id"),
    /**
     * The conversation was started for this message alone (a bot-to-bot
     * send runs fresh, unattended and on a token budget, like a routine
     * run), not the target's chat. Lets the conversation be traced back to
     * its bot (bots.owner.ts).
     */
    ownConversation: bool("own_conversation").notNull().default(false),
    /** Conversation that receives this message's answer (the host of a mention, or the sender). Null = only the owner. */
    replyToBotId: text("reply_to_bot_id").references(() => bots.id, { onDelete: "cascade" }),
    /** "send" (message_bot tool) | "mention" (owner @tag) | "relay" (relayed reply). */
    kind: text("kind").notNull(),
    /** Idempotency key of the durable submit (requestId of conversation.submit). */
    requestId: text("request_id").notNull().unique(),
    /** Durable tool-call id: exactly-once row create across pi-durable replays. */
    sourceKey: text("source_key").unique(),
    text: text("text").notNull(),
    /** When the message was submitted into the target's durable conversation (pending → delivered). */
    deliveredAt: ms("delivered_at"),
    /** When the target's reply was relayed into replyToBotId's conversation (delivered → answered). */
    answeredAt: ms("answered_at"),
    /** Created-at of the Finished reply that answered this delivery (matched by requestId). */
    answerReplyAt: ms("answer_reply_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("bot_messages_to_bot_id_answered_at_idx").on(t.toBotId, t.answeredAt),
    index("bot_messages_reply_to_bot_id_answered_at_idx").on(t.replyToBotId, t.answeredAt),
  ],
);

/**
 * Shelley hand-offs (issue #143): a bot started coding work in Shelley with
 * `shelley_start`. When that conversation's turn ends, the finish is
 * delivered once into the bot's chat (running → finished, compare-and-set).
 */
export const shelleyHandoffs = sqliteTable(
  "shelley_handoffs",
  {
    id: id(),
    botId: text("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    shelleyConversationId: text("shelley_conversation_id").notNull(),
    slug: text("slug"),
    /** What the bot asked Shelley to do (first message), for the card and list. */
    task: text("task").notNull(),
    cwd: text("cwd"),
    /** Durable tool task identity: a replayed `shelley_start` returns this row. */
    idempotencyKey: text("idempotency_key").notNull().unique(),
    /** "running" | "finished". */
    status: text("status").notNull(),
    createdAt: createdAt(),
    finishedAt: ms("finished_at"),
  },
  (t) => [
    index("shelley_handoffs_conversation_idx").on(t.shelleyConversationId),
    index("shelley_handoffs_bot_idx").on(t.botId, t.createdAt),
  ],
);

/**
 * Shelley conversations the owner follows from tiny-agents (started, opened
 * or handed off here): unread markers and finish pushes (issue #143).
 */
export const shelleySeen = sqliteTable("shelley_seen", {
  conversationId: text("conversation_id").primaryKey(),
  /** Highest Shelley `sequence_id` the owner has seen in it. */
  lastSeenSequenceId: integer("last_seen_sequence_id").notNull().default(0),
  updatedAt: ms("updated_at")
    .notNull()
    .$defaultFn(() => new Date()),
});

/**
 * The Code page's thread index (ADR 0011): one row per harness thread
 * tiny-agents tracks. Every harness keeps its own transcript; this row holds
 * pointers and metadata only — what the owner follows and has read
 * (unread, pushes), and, for harnesses that keep no list of their own
 * (Claude Code), the thread itself (title, cwd, settings, driver `data`).
 */
export const codeThreads = sqliteTable(
  "code_threads",
  {
    /** `<instanceId>:<nativeId>`. */
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
    /** Started, opened or handed off here: unread markers and finish pushes. */
    followed: bool("followed").notNull().default(false),
    /** How far into the transcript the owner has read (harness cursor). */
    seenCursor: integer("seen_cursor").notNull().default(0),
    /** Driver-private JSON (e.g. Claude Code's session id). */
    data: text("data").notNull().default("{}"),
    /** The project the thread was started in (issue #297); null for a thread without one. */
    projectId: text("project_id").references((): AnySQLiteColumn => codeProjects.id, {
      onDelete: "set null",
    }),
    /** A project thread's branch, and the base commit its worktree was cut from. */
    branch: text("branch"),
    baseSha: text("base_sha"),
    /** A project thread's worktree on the sandbox, while it has one (removed on archive). */
    worktree: text("worktree"),
    /** Stop Auto-fix passes once the thread has cost this much (USD; where the harness reports cost). */
    spendLimitUsd: real("spend_limit_usd"),
    createdAt: createdAt(),
    updatedAt: ms("updated_at")
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("code_threads_instance_idx").on(t.instanceId, t.updatedAt),
    index("code_threads_project_idx").on(t.projectId),
  ],
);

/**
 * A Code project (issue #297 §6): one GitHub repository, its checkout on the
 * sandbox, and the defaults and rules for threads started in it. Settings
 * that only a few code paths read are JSON (`settings`, parsed with
 * `projectSettings` in `code.projects.ts`).
 */
export const codeProjects = sqliteTable(
  "code_projects",
  {
    id: id(),
    name: text("name").notNull(),
    repoOwner: text("repo_owner").notNull(),
    repoName: text("repo_name").notNull(),
    /** How the app reaches GitHub: `gh` (the CLI on the sandbox, or a vault token) or `app` (phase 6). */
    transport: text("transport").$type<"gh" | "app">().notNull().default("gh"),
    baseBranch: text("base_branch").notNull(),
    /** The clone on the sandbox; worktrees live beside it. */
    checkoutPath: text("checkout_path").notNull(),
    /** The GitHub App installation that reaches the repository (transport `app`). */
    installationId: integer("installation_id"),
    /** The harness instance and model a new thread starts on. */
    defaultInstanceId: text("default_instance_id"),
    defaultModel: text("default_model"),
    /** JSON: scripts override, archive on merge, protected paths, Auto-fix triggers, trusted bots. */
    settings: text("settings").notNull().default("{}"),
    createdAt: createdAt(),
    updatedAt: ms("updated_at")
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [uniqueIndex("code_projects_repo_idx").on(t.repoOwner, t.repoName)],
);

/**
 * Pull requests linked to Code threads (issue #297 §7.5): a cache of GitHub,
 * refreshed by the reconciler, plus the thread's Auto-fix loop for it. A
 * thread may have several over time but at most one open; a PR belongs to
 * one thread.
 */
export const codePullRequests = sqliteTable(
  "code_pull_requests",
  {
    id: id(),
    /** `<instanceId>:<nativeId>`. */
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
    /** Enable GitHub's native auto-merge once no pass runs (phase 6); an owner's off is sticky. */
    autoMerge: bool("auto_merge").notNull().default(false),
    /** The last snapshot (`PullSnapshot` JSON), what the PR tab shows. */
    snapshot: text("snapshot"),
    syncedAt: ms("synced_at"),
    autofix: bool("autofix").notNull().default(false),
    /** The Auto-fix loop (shared/machines/autofix.ts). */
    loopStatus: text("loop_status").$type<AutofixStatus>().notNull().default("off"),
    /** Why the loop waits on the owner, paused or switched itself off. */
    loopReason: text("loop_reason"),
    loopChangedAt: ms("loop_changed_at"),
    /** The head sha when the loop last changed state. */
    loopHeadSha: text("loop_head_sha"),
    /** Passes in a row with no owner input (switches Auto-fix off at the limit). */
    passesWithoutOwner: integer("passes_without_owner").notNull().default(0),
    /** When the owner last wrote in the thread or switched Auto-fix on. */
    ownerInputAt: ms("owner_input_at"),
    /** The reconcile job queued for it (the chain), so a run re-arms only its own. */
    pendingJobId: text("pending_job_id"),
    /** When a stalled check was last reported, so it is reported once. */
    stalledNotifiedSha: text("stalled_notified_sha"),
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

/** Comments the app posted on a linked PR (they never start a pass, whoever GitHub says wrote them). */
export const codePrComments = sqliteTable("code_pr_comments", {
  /** GitHub's database id of the comment. */
  id: integer("id").primaryKey(),
  pullId: text("pull_id")
    .notNull()
    .references(() => codePullRequests.id, { onDelete: "cascade" }),
  passId: text("pass_id"),
  createdAt: createdAt(),
});

/**
 * Auto-fix passes (issue #297 §9.3): claimed before the harness hears
 * anything, keyed by the state of the PR they act on, finished when the
 * thread's turn ends.
 */
export const codeAutofixPasses = sqliteTable(
  "code_autofix_passes",
  {
    id: id(),
    pullId: text("pull_id")
      .notNull()
      .references(() => codePullRequests.id, { onDelete: "cascade" }),
    /** checks, review, conflict, manual. */
    trigger: text("trigger").notNull(),
    /** Hash of the head sha and the item ids: one pass per state of the PR. */
    stateHash: text("state_hash").notNull(),
    /** JSON: the items the pass was asked to handle (ids, kinds, text sent). */
    items: text("items").notNull().default("[]"),
    /** The pass machine (shared/machines/autofix-pass.ts). */
    status: text("status").$type<AutofixPassStatus>().notNull(),
    /** The worktree's head when the pass was sent. */
    startSha: text("start_sha"),
    pushedSha: text("pushed_sha"),
    /** The thread's cost when the pass started, and what the pass cost (where the harness reports cost). */
    startCostUsd: real("start_cost_usd"),
    costUsd: real("cost_usd"),
    /** pushed, no_progress, rejected, protected_path, timed_out, diverged, send_failed. */
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

/**
 * Per-turn checkpoints of a project thread (phase 6): the worktree at each
 * turn end, uncommitted files included, as a commit kept under a hidden ref
 * (`refs/tiny-agents/checkpoints/…`). `seq` 0 is the thread's start.
 */
export const codeCheckpoints = sqliteTable(
  "code_checkpoints",
  {
    id: id(),
    threadId: text("thread_id").notNull(),
    seq: integer("seq").notNull(),
    sha: text("sha").notNull(),
    /** The branch head when it was taken. */
    headSha: text("head_sha").notNull(),
    /** start, turn, before_revert. */
    reason: text("reason").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("code_checkpoints_seq_idx").on(t.threadId, t.seq)],
);

/** GitHub App webhook deliveries (phase 6): the id is unique, so a redelivery is dropped. */
export const codePrEvents = sqliteTable("code_pr_events", {
  deliveryId: text("delivery_id").primaryKey(),
  event: text("event").notNull(),
  /** The linked PR the delivery was about, when one matched. */
  pullId: text("pull_id"),
  receivedAt: createdAt(),
});

/** Files the owner marked viewed in Changes, by content: a changed file comes back unmarked. */
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

/** Line comments drafted in Changes, sent to the agent together (`sentAt` once sent). */
export const codeReviewDrafts = sqliteTable(
  "code_review_drafts",
  {
    id: id(),
    threadId: text("thread_id").notNull(),
    path: text("path").notNull(),
    side: text("side").$type<"old" | "new">().notNull().default("new"),
    startLine: integer("start_line").notNull(),
    endLine: integer("end_line").notNull(),
    /** The lines commented on, quoted, so the comment still reads after they move. */
    quote: text("quote").notNull().default(""),
    body: text("body").notNull(),
    /**
     * Who it is for: the agent (sent with the next message), or GitHub (a PR
     * review's pending comment, posted with its review, issue #345).
     */
    target: text("target").$type<"agent" | "github">().notNull().default("agent"),
    createdAt: createdAt(),
    sentAt: ms("sent_at"),
  },
  (t) => [index("code_review_drafts_thread_idx").on(t.threadId, t.sentAt)],
);

/**
 * PR reviews (issue #345): any pull request of a project's repository, the
 * owner's or someone else's, checked out at its head in a worktree of its
 * own. The assistant thread is made on the first question (`threadId`), so
 * opening a review costs no model call. Viewed marks and line comments are
 * kept under the review's key (`review:<id>`) until then.
 */
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
    /** The PR's branch (on the fork, for a PR from one) and base. */
    headRef: text("head_ref").notNull(),
    baseRef: text("base_ref").notNull(),
    /** The head the worktree is checked out at. */
    headSha: text("head_sha").notNull(),
    fromFork: bool("from_fork").notNull().default(false),
    /** The owner opened the PR: GitHub lets them only comment on it, not approve. */
    mine: bool("mine").notNull().default(false),
    /** The commit of the owner's last review of it on GitHub, for "Since your review". */
    reviewedSha: text("reviewed_sha"),
    /** On the sandbox while the review is open (removed on archive). */
    worktree: text("worktree"),
    /** `<instanceId>:<nativeId>` of the assistant, once asked. */
    threadId: text("thread_id"),
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

/**
 * Coding work a bot handed to a harness (`code_start`, or `shelley_start`).
 * A start claims its row (`starting`) before the harness makes the thread,
 * so a replayed start never makes a second one. When that thread's turn
 * ends, the finish is owed to the conversation that asked (running →
 * finished, compare-and-set, with its `code_handoff_finishes` row).
 */
export const codeHandoffs = sqliteTable(
  "code_handoffs",
  {
    id: id(),
    botId: text("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    /** `<instanceId>:<nativeId>`; null while `starting` (the harness has not made it yet). */
    threadId: text("thread_id"),
    title: text("title"),
    /** What the bot asked for (first message), for the card and list. */
    task: text("task").notNull(),
    cwd: text("cwd"),
    /**
     * The conversation that last asked (started, adopted or followed up):
     * the bot's chat, a routine run's or a bot message's. Its finish goes
     * back there (`deliverHandoffFinish`); null on rows from before it was
     * kept, which go to the bot's chat.
     */
    conversationId: text("conversation_id"),
    /** Durable tool task identity: a replayed start returns this row. */
    idempotencyKey: text("idempotency_key").notNull().unique(),
    /** The hand-off machine (shared/machines/handoff.ts). */
    status: text("status").$type<HandoffStatus>().notNull(),
    createdAt: createdAt(),
    /**
     * When its turn end was recorded, or, while a follow-up runs, when that
     * reopened it: a reconnect owes only a turn that ended after the reopen.
     */
    finishedAt: ms("finished_at"),
  },
  (t) => [
    index("code_handoffs_thread_idx").on(t.threadId),
    index("code_handoffs_bot_idx").on(t.botId, t.createdAt),
  ],
);

/**
 * Hand-off finishes owed to a bot's chat (register row C7): written in the
 * same transaction as the hand-off's running → finished move, delivered at
 * least once (after a crash or a failed submit, again until it lands) and
 * never twice, because the submit is idempotent by `requestId`.
 * `deliveredAt` marks the submit done.
 */
export const codeHandoffFinishes = sqliteTable(
  "code_handoff_finishes",
  {
    id: id(),
    handoffId: text("handoff_id")
      .notNull()
      .references(() => codeHandoffs.id, { onDelete: "cascade" }),
    /** Idempotency key of the submit into the bot's chat (one per turn end). */
    requestId: text("request_id").notNull().unique(),
    /** Who the reply is from: the harness's label. */
    harness: text("harness").notNull(),
    /** The chat text, framed and sanitized (`handoffFinishText`). */
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
  /** Capability id suffix (`mcp:<slug>`) and tool name prefix; immutable. */
  slug: text("slug").notNull().unique(),
  url: text("url").notNull(),
  /** streamable-http | sse */
  transport: text("transport").notNull().default("streamable-http"),
  /** none | header | oauth */
  authType: text("auth_type").notNull().default("none"),
  /** Header carrying the header value for header auth (e.g. Authorization, x-api-key). */
  headerName: text("header_name"),
  /**
   * Before Q4, the header value itself (AES-GCM, SECRETS_KEY). Only the
   * startup import (`vault/vault.import.ts`) reads it, moving it into a vault
   * item (`secretItemId`) and clearing it.
   */
  secretEnc: text("secret_enc"),
  /** AES-GCM (SECRETS_KEY) encrypted OAuth state: client registration, tokens, PKCE verifier. */
  oauthEnc: text("oauth_enc"),
  /** JSON array of the server's tools as last listed: [{ name, title, description, readOnly }]. */
  toolsCache: text("tools_cache").notNull().default("[]"),
  /** JSON array of server tool names turned off for every bot; tools the server adds later start on. */
  disabledTools: text("disabled_tools").notNull().default("[]"),
  /** Vault handle (`vaultItems.handle`) the owner chose for the header value; preferred over `secretItemId`. */
  secretRef: text("secret_ref"),
  /**
   * The connection's own header value (Q4): the id of a vault item it
   * created, used when `secretRef` is unset and deleted with the connection.
   * No foreign key: drizzle-kit adds the column without its ON DELETE, and a
   * deleted item reads like a `secretRef` to a deleted handle.
   */
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
  /** Model-facing slug ("github"); the only name bots see. */
  handle: text("handle").notNull().unique(),
  /** login | card | identity | api_key */
  kind: text("kind").notNull(),
  /** local */
  backend: text("backend").notNull(),
  /**
   * Who uses the value: `bots` (listed to bots, used through their tools,
   * with approvals) or `app` (the server's own sinks, e.g. a model provider's
   * key; never listed to bots or resolved through their tools).
   */
  audience: text("audience").notNull().default("bots"),
  /** Backend item id. */
  externalId: text("external_id").notNull(),
  /** api_key: which field holds the key (default: the credential/password field). */
  field: text("field"),
  label: text("label").notNull(),
  /** Login identifier: metadata the bot may type itself. */
  username: text("username"),
  /** JSON array of exact origins a login or card fills on. */
  originsJson: text("origins_json").notNull().default("[]"),
  /** JSON array of hosts an api_key header may go to. */
  hostsJson: text("hosts_json").notNull().default("[]"),
  /** JSON {as:"header",name,format} for api_key injection. */
  injectJson: text("inject_json"),
  /** JSON array of tools that may use it; [] = the kind's default. */
  toolsJson: text("tools_json").notNull().default("[]"),
  /** JSON array of bot ids that may use it; null = every bot. */
  botsJson: text("bots_json"),
  /** every_use | per_conversation | allowed */
  approval: text("approval").notNull().default("per_conversation"),
  allowUnattended: bool("allow_unattended").notNull().default(false),
  whenToUse: text("when_to_use"),
  /** JSON {brand,last4,expiry}: display only. */
  cardMetaJson: text("card_meta_json"),
  hasTotp: bool("has_totp").notNull().default(false),
  disabled: bool("disabled").notNull().default(false),
  lastUsedAt: ms("last_used_at"),
  lastUsedBy: text("last_used_by"),
  ...timestamps,
});

/**
 * The local vault backend's values (Q4): one row per backend item, the id
 * being the `externalId` a `vault_items` row links. The item (title, urls,
 * values) is sealed with SECRETS_KEY (`crypto/secret-box.ts`, purpose
 * `vault-local`), its id and policy digest in the AAD. `policy` is the digest
 * it is sealed under; it is the authority only while no row links the value
 * (S11, `api/vault/backends/local.ts`).
 */
export const vaultValues = sqliteTable("vault_values", {
  id: text("id").primaryKey(),
  /** `v2:<kid>:<iv>:<tag>:<ciphertext>`. */
  sealed: text("sealed").notNull(),
  /** The policy digest in the AAD; "" for an item sealed under none. */
  policy: text("policy").notNull().default(""),
  ...timestamps,
});

/**
 * A provider account (issue #179): one way of reaching models. Its id is
 * also its pi-ai provider id. The key is an `app` vault item.
 */
export const providers = sqliteTable("providers", {
  id: id(),
  name: text("name").notNull(),
  /** anthropic | openai-chat | openai-responses | gemini | cloudflare-ai-gateway | claude-plan | faux */
  kind: text("kind").notNull(),
  /** Canonical base URL; null for kinds that derive it (claude-plan, faux, gateway routes). */
  baseUrl: text("base_url"),
  /** The vault item holding the key (audience `app`); null: keyless or a gateway route. */
  credentialItemId: text("credential_item_id").references(() => vaultItems.id, {
    onDelete: "restrict",
  }),
  /** What the UI shows of the key ("sk-…a1B2"); never more. */
  credentialHint: text("credential_hint"),
  /** Gateway route: the cloudflare-ai-gateway account this one goes through. */
  viaProviderId: text("via_provider_id").references((): AnySQLiteColumn => providers.id, {
    onDelete: "restrict",
  }),
  /** Kind-specific, non-secret settings (JSON); see `ProviderAccount.settings`. */
  settingsJson: text("settings_json").notNull().default("{}"),
  /** auto: discovery lists models; manual: the owner adds them ("single model"). */
  discovery: text("discovery").notNull().default("auto"),
  /** The owner opted in to a private or LAN endpoint (Ollama, LM Studio). */
  allowPrivateNetwork: bool("allow_private_network").notNull().default(false),
  enabled: bool("enabled").notNull().default(true),
  /** ok | unchecked | key_rejected | unreachable | locked */
  status: text("status").notNull().default("unchecked"),
  statusDetail: text("status_detail"),
  checkedAt: ms("checked_at"),
  /** Bumped on every write; `If-Match` on edits. */
  version: integer("version").notNull().default(1),
  ...timestamps,
});

/** A model row under a provider account (issue #179). */
export const models = sqliteTable(
  "models",
  {
    id: id(),
    providerId: text("provider_id")
      .notNull()
      .references(() => providers.id, { onDelete: "cascade" }),
    /** Wire id ("claude-sonnet-4-6"). */
    upstreamId: text("upstream_id").notNull(),
    name: text("name").notNull(),
    /** chat | classifier */
    type: text("type").notNull().default("chat"),
    /** discovered | manual */
    source: text("source").notNull(),
    /** Offered in the picker. */
    enabled: bool("enabled").notNull().default(true),
    /** Resolved capabilities: override, else catalog, else the kind's default. */
    contextWindow: integer("context_window").notNull(),
    maxOutputTokens: integer("max_output_tokens").notNull(),
    imageInput: bool("image_input").notNull(),
    reasoning: bool("reasoning").notNull(),
    /** Owner overrides (JSON); a key present wins over the catalog. */
    overridesJson: text("overrides_json").notNull().default("{}"),
    /** pi-ai compat flags (JSON), from the template or Advanced. */
    compatJson: text("compat_json"),
    /** The upstream stopped listing it; kept so references stay valid. */
    missingSince: ms("missing_since"),
    ...timestamps,
  },
  (t) => [uniqueIndex("models_provider_upstream_idx").on(t.providerId, t.upstreamId)],
);

/** Which model a feature uses (issue #179). Unset roles use their documented fallback. */
export const modelRoles = sqliteTable("model_roles", {
  /** bot_default | memory_capture | chat_title | vision | classifier */
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
    /** Kept when the item is deleted. */
    handle: text("handle").notNull(),
    botId: text("bot_id"),
    conversationId: integer("conversation_id"),
    taskId: integer("task_id"),
    /** Agent tool, "vault_ui" or "credential_request". */
    tool: text("tool").notNull(),
    /** Origin, host or redacted command. */
    target: text("target").notNull(),
    /** used | approved_used | denied | expired | refused_* | backend_error | created | updated | deleted | revealed | copied | filled */
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
  /** "image" | "file" */
  kind: text("kind").notNull(),
  /** Original filename, sanitized. */
  name: text("name").notNull(),
  mimeType: text("mime_type").notNull(),
  /** Original byte size. */
  size: integer("size").notNull(),
  /** Images only, after preparation. */
  width: integer("width"),
  height: integer("height"),
  /** Storage key of the model-ready image variant (null for files). */
  modelKey: text("model_key"),
  /** Storage key of the original bytes. */
  storageKey: text("storage_key").notNull().unique(),
  /** The user who uploaded it; a guest reads their own uploads. */
  uploadedBy: integer("uploaded_by"),
  /** The bot whose chat it was first sent in; a guest of that bot reads it. */
  botId: text("bot_id"),
  createdAt: createdAt(),
  /** SHA-256 of the original bytes (sandbox copies report it). */
  sha256: text("sha256"),
  /** Extraction (issue #58): the extraction machine (shared/machines/extraction.ts). */
  extractStatus: text("extract_status").$type<ExtractStatus>().notNull().default("none"),
  /** Why extraction failed, or why the type can't be read. */
  extractError: text("extract_error"),
  /** JSON ExtractMeta: format, pages, sheets, lines, entries, truncated, … */
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
    /** Max 80 chars. */
    name: text("name").notNull(),
    /** Max 20k chars. */
    prompt: text("prompt").notNull(),
    /** Schedule union (once | cron | interval), parsed with Zod at every boundary. */
    schedule: text("schedule", { mode: "json" }).$type<unknown>().notNull(),
    /** Paused or terminal (a fired once) routines keep their row but schedule nothing. */
    enabled: bool("enabled").notNull().default(true),
    /** Next occurrence as an absolute UTC instant; null when disabled or terminal. */
    nextRunAt: ms("next_run_at"),
    /** The queued routine-fire job for nextRunAt (cancel/reschedule handle). */
    pendingJobId: text("pending_job_id").unique(),
    /** Durable tool-call id: exactly-once row create across pi-durable replays. */
    sourceKey: text("source_key").unique(),
    /** The conversation of the routine's latest run: each run starts a fresh one (never the bot's chat). Null until first fire. */
    conversationId: text("conversation_id").unique(),
    /** Runs in a row that ended blocked (issue #87); a run that finishes any other way, or arming the routine again, resets it. */
    blockedStreak: integer("blocked_streak").notNull().default(0),
    /** Why the app paused the routine itself (issue #87). Max 500 chars; cleared when it is armed again. */
    pausedReason: text("paused_reason"),
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
    /** One self-contained third-person sentence, max 300 chars. */
    text: text("text").notNull(),
    /** preference | fact | goal | habit (Zod-validated at every boundary). */
    category: text("category").notNull(),
    /** The memory machine (shared/machines/memory.ts). Only `active` injects. */
    status: text("status").$type<MemoryStatus>().notNull().default("active"),
    /** capture | manual (source line on the Memory page). */
    source: text("source").notNull().default("capture"),
    /** Unused since #334 D: capture no longer asks for it; old rows keep theirs. */
    confidence: real("confidence"),
    /** Optional expiry; null = no expiry. Expired rows stay rows, leave the prompt. */
    until: ms("until"),
    /**
     * The conversation it was learned in (capture of that chat, or `remember`
     * there); null for the Memory page. That conversation already holds the
     * fact, so the memory alone never re-sends its prompt section there.
     */
    conversationId: text("conversation_id"),
    /** Set when a newer memory replaced this one (strike-through in the UI). */
    supersededById: text("superseded_by_id"),
    supersededAt: ms("superseded_at"),
    ...timestamps,
  },
  (t) => [index("memories_bot_id_status_category_idx").on(t.botId, t.status, t.category)],
);

/**
 * Full-snapshot revisions of a bot's system prompt (self-improvement):
 * every applied `update_instructions` change lands here before the
 * row is updated — append-only history, the database analog of committing
 * an instructions file. The current prompt is `bots.system_prompt`; this
 * table is the log that makes every change revertable.
 */
export const promptRevisions = sqliteTable(
  "prompt_revisions",
  {
    id: id(),
    botId: text("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    /** The complete system prompt after this change.
     *
     * manual (bot editor) | self (update_instructions tool).
     */
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
    /** The occurrence this run represents (UTC instant). */
    scheduledFor: ms("scheduled_for").notNull(),
    /** The routine-run machine (shared/machines/routine-run.ts). */
    status: text("status").$type<RoutineRunStatus>().notNull(),
    /** schedule | manual */
    trigger: text("trigger").$type<"schedule" | "manual">().notNull().default("schedule"),
    /** pi-durable submit id: "routine:<routineId>:<scheduledFor ISO>". */
    requestId: text("request_id").notNull().unique(),
    submittedAt: ms("submitted_at"),
    startedAt: ms("started_at"),
    finishedAt: ms("finished_at"),
    /** Reply preview, max 2000 chars. */
    output: text("output"),
    /** Failure or blocked reason, max 500 chars. */
    error: text("error"),
    /** The run's own fresh durable conversation; null for runs from before runs had one. */
    conversationId: text("conversation_id"),
    /** Tokens the run's conversation used, read when the run settled. */
    tokens: integer("tokens"),
  },
  (t) => [
    unique("routine_runs_routine_id_scheduled_for_unique").on(t.routineId, t.scheduledFor),
    index("routine_runs_status_idx").on(t.status),
    index("routine_runs_conversation_id_idx").on(t.conversationId),
  ],
);

/**
 * Guests (shared bots): people the owner added to chat with the bots shared
 * with them, and to use Code. An account with no row here is the owner.
 */
export const guests = sqliteTable("guests", {
  userId: integer("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
});

/** Which guests a bot is shared with: they are in its chat with the owner. */
export const botGuests = sqliteTable(
  "bot_guests",
  {
    botId: text("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** The guest's own read marker (the bot row's is the owner's). */
    lastReadAt: ms("last_read_at"),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.botId, t.userId] }),
    index("bot_guests_user_id_idx").on(t.userId),
  ],
);

/**
 * Devices that receive Web Push notifications (issue #306): the Android app
 * through UnifiedPush (FCM or a distributor such as ntfy), later browsers.
 * The endpoint and keys are what the device's push service gave it; the
 * server encrypts each push for `p256dh` + `auth`.
 */
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
    /** fcm | unifiedpush | browser */
    distributor: text("distributor").$type<"fcm" | "unifiedpush" | "browser">().notNull(),
    /** What the device calls itself, e.g. "Pixel 8". */
    label: text("label").notNull().default(""),
    appVersion: text("app_version"),
    status: text("status").$type<PushSubscriptionStatus>().notNull().default("active"),
    /** Consecutive failed sends; reset by a delivery. */
    failureCount: integer("failure_count").notNull().default(0),
    lastError: text("last_error"),
    lastSuccessAt: ms("last_success_at"),
    createdAt: createdAt(),
    /** The device last registered (or re-registered) this endpoint. */
    lastSeenAt: ms("last_seen_at")
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index("push_subscriptions_user_id_idx").on(t.userId)],
);

/**
 * Side-calls as trace metadata (Traces, issue #363): one row per one-shot
 * model call the app makes outside a conversation (memory capture, titles,
 * Code naming, auto-review). Never the prompt or the answer: a conversation's
 * own calls are read from its entries in agent.db instead. Rows older than
 * 30 days are pruned as new ones are written.
 */
export const llmCalls = sqliteTable(
  "llm_calls",
  {
    id: id(),
    /** What the call was for, as its side-call label ("Memory capture", "Chat title"). */
    purpose: text("purpose").notNull(),
    /** The bot it ran for, when there is one. */
    botId: text("bot_id").references(() => bots.id, { onDelete: "cascade" }),
    /** The model row the call resolved to. */
    modelId: text("model_id"),
    provider: text("provider"),
    model: text("model"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    costUsd: real("cost_usd").notNull().default(0),
    durationMs: integer("duration_ms"),
    /** ok | error | timeout | aborted. Written once, never moved. */
    outcome: text("outcome").$type<"ok" | "error" | "timeout" | "aborted">().notNull(),
    /** The failure, max 200 chars. */
    error: text("error"),
    createdAt: createdAt(),
  },
  (t) => [index("llm_calls_created_at_idx").on(t.createdAt)],
);

export * from "@groot/core/notification/notification.schema";

// ── Relations (relational queries: `db.query.bots.findMany({ with: … })`) ──

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
export type ShelleyHandoff = typeof shelleyHandoffs.$inferSelect;
export type CodeThreadRow = typeof codeThreads.$inferSelect;
export type CodeHandoff = typeof codeHandoffs.$inferSelect;
export type CodeProjectRow = typeof codeProjects.$inferSelect;
export type CodePullRow = typeof codePullRequests.$inferSelect;
export type CodeAutofixPass = typeof codeAutofixPasses.$inferSelect;
export type CodeReviewDraft = typeof codeReviewDrafts.$inferSelect;
export type CodeCheckpoint = typeof codeCheckpoints.$inferSelect;
export type BotGuest = typeof botGuests.$inferSelect;
export type ProviderRow = typeof providers.$inferSelect;
export type ModelRowRecord = typeof models.$inferSelect;

export * from "@groot/core/database/schema";
export * from "@groot/jobs/server/schema";
