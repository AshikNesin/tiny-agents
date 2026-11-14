import { relations } from "drizzle-orm";
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
import type { HandoffStatus } from "../../shared/machines/handoff";
import type { MemoryStatus } from "../../shared/machines/memory";
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
    createdAt: createdAt(),
    updatedAt: ms("updated_at")
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index("code_threads_instance_idx").on(t.instanceId, t.updatedAt)],
);

/**
 * Coding work a bot handed to a harness (`code_start`, or `shelley_start`).
 * A start claims its row (`starting`) before the harness makes the thread,
 * so a replayed start never makes a second one. When that thread's turn
 * ends, the finish is owed to the bot's chat (running → finished,
 * compare-and-set, with its `code_handoff_finishes` row).
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
    /** The routine's own durable conversation (issue #63): every run is submitted here, never into the bot's chat. Null until first fire. */
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
    /** Extraction confidence 0..1; null for manual entries. */
    confidence: real("confidence"),
    /** Optional expiry; null = no expiry. Expired rows stay rows, leave the prompt. */
    until: ms("until"),
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
  },
  (t) => [
    unique("routine_runs_routine_id_scheduled_for_unique").on(t.routineId, t.scheduledFor),
    index("routine_runs_status_idx").on(t.status),
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
export type ShelleyHandoff = typeof shelleyHandoffs.$inferSelect;
export type CodeThreadRow = typeof codeThreads.$inferSelect;
export type CodeHandoff = typeof codeHandoffs.$inferSelect;
export type BotGuest = typeof botGuests.$inferSelect;
export type ProviderRow = typeof providers.$inferSelect;
export type ModelRowRecord = typeof models.$inferSelect;

export * from "@groot/core/database/schema";
export * from "@groot/jobs/server/schema";
