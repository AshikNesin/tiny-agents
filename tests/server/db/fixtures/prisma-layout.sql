-- The SQLite layout tiny-agents' Prisma migrations produced (tables and indexes),
-- captured from a database migrated with the last Prisma release. Used by
-- legacy-copy.test.ts to build a pre-Drizzle database without Prisma.

CREATE TABLE "_prisma_migrations" (
    "id"                    TEXT PRIMARY KEY NOT NULL,
    "checksum"              TEXT NOT NULL,
    "finished_at"           DATETIME,
    "migration_name"        TEXT NOT NULL,
    "logs"                  TEXT,
    "rolled_back_at"        DATETIME,
    "started_at"            DATETIME NOT NULL DEFAULT current_timestamp,
    "applied_steps_count"   INTEGER UNSIGNED NOT NULL DEFAULT 0
);

CREATE TABLE "bot_chats" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "botId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL,
    "endedAt" DATETIME NOT NULL,
    "title" TEXT,
    "lastMessagePreview" TEXT,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "bot_chats_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "bot_connections" (
    "botId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("botId", "connectionId"),
    CONSTRAINT "bot_connections_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "bot_connections_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "connections" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "bot_messages" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fromBotId" TEXT,
    "toBotId" TEXT NOT NULL,
    "replyToBotId" TEXT,
    "kind" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "sourceKey" TEXT,
    "text" TEXT NOT NULL,
    "answeredAt" DATETIME,
    "deliveredAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "answerReplyAt" DATETIME,
    CONSTRAINT "bot_messages_fromBotId_fkey" FOREIGN KEY ("fromBotId") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "bot_messages_toBotId_fkey" FOREIGN KEY ("toBotId") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "bot_messages_replyToBotId_fkey" FOREIGN KEY ("replyToBotId") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "bot_skills" (
    "botId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("botId", "skillId"),
    CONSTRAINT "bot_skills_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "bot_skills_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "skills" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "bots" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "systemPrompt" TEXT NOT NULL DEFAULT '',
    "modelId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "chatStartedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastReadAt" DATETIME,
    "lastActivityAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessagePreview" TEXT,
    "toolPermissions" TEXT NOT NULL DEFAULT '{}',
    "memoryEnabled" BOOLEAN NOT NULL DEFAULT true,
    "autoReview" BOOLEAN NOT NULL DEFAULT false,
    "memoryCapturedThrough" DATETIME,
    "pinnedAt" DATETIME,
    "browserProfile" TEXT NOT NULL DEFAULT 'shared',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "connections" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "transport" TEXT NOT NULL DEFAULT 'streamable-http',
    "authType" TEXT NOT NULL DEFAULT 'none',
    "headerName" TEXT,
    "secretEnc" TEXT,
    "oauthEnc" TEXT,
    "toolsCache" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
, "disabledTools" TEXT NOT NULL DEFAULT '[]', "secretRef" TEXT);

CREATE TABLE "job_logs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "jobId" TEXT NOT NULL,
    "jobName" TEXT,
    "level" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "data" JSONB,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "keyv" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL
);

CREATE TABLE "memories" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "botId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "source" TEXT NOT NULL DEFAULT 'capture',
    "confidence" REAL,
    "until" DATETIME,
    "supersededById" TEXT,
    "supersededAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "memories_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "memories_supersededById_fkey" FOREIGN KEY ("supersededById") REFERENCES "memories" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "notification_log" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "event" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "botId" TEXT,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "priority" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "providerId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" DATETIME
);

CREATE TABLE "passkeys" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "credentialId" TEXT NOT NULL,
    "publicKey" BLOB NOT NULL,
    "counter" BIGINT NOT NULL DEFAULT 0,
    "deviceType" TEXT,
    "backedUp" BOOLEAN NOT NULL DEFAULT false,
    "transports" JSONB NOT NULL,
    "credentialName" TEXT,
    "lastUsedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "passkeys_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "routine_runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "routineId" TEXT NOT NULL,
    "scheduledFor" DATETIME NOT NULL,
    "status" TEXT NOT NULL,
    "trigger" TEXT NOT NULL DEFAULT 'schedule',
    "requestId" TEXT NOT NULL,
    "submittedAt" DATETIME,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "output" TEXT,
    "error" TEXT,
    CONSTRAINT "routine_runs_routineId_fkey" FOREIGN KEY ("routineId") REFERENCES "routines" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "routines" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "botId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "schedule" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "nextRunAt" DATETIME,
    "pendingJobId" TEXT,
    "sourceKey" TEXT,
    "conversationId" TEXT,
    "blockedStreak" INTEGER NOT NULL DEFAULT 0,
    "pausedReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "routines_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "skills" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "files" TEXT NOT NULL DEFAULT '[]',
    "source" TEXT NOT NULL DEFAULT 'manual',
    "sourceUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "tasks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'todo',
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "dueAt" DATETIME,
    "completedAt" DATETIME,
    "sourceKey" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "uploads" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "modelKey" TEXT,
    "storageKey" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sha256" TEXT,
    "extractStatus" TEXT NOT NULL DEFAULT 'none',
    "extractError" TEXT,
    "extractMeta" TEXT,
    "extractedAt" DATETIME
);

CREATE TABLE "users" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "vault_audit_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "itemId" TEXT,
    "handle" TEXT NOT NULL,
    "botId" TEXT,
    "conversationId" INTEGER,
    "taskId" INTEGER,
    "tool" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "reason" TEXT,
    "unattended" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "vault_audit_events_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "vault_items" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "vault_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "handle" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "backend" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "field" TEXT,
    "label" TEXT NOT NULL,
    "username" TEXT,
    "originsJson" TEXT NOT NULL DEFAULT '[]',
    "hostsJson" TEXT NOT NULL DEFAULT '[]',
    "injectJson" TEXT,
    "toolsJson" TEXT NOT NULL DEFAULT '[]',
    "botsJson" TEXT,
    "approval" TEXT NOT NULL DEFAULT 'per_conversation',
    "allowUnattended" BOOLEAN NOT NULL DEFAULT false,
    "whenToUse" TEXT,
    "cardMetaJson" TEXT,
    "hasTotp" BOOLEAN NOT NULL DEFAULT false,
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "lastUsedAt" DATETIME,
    "lastUsedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE INDEX "bot_chats_botId_endedAt_idx" ON "bot_chats"("botId", "endedAt");

CREATE UNIQUE INDEX "bot_chats_conversationId_key" ON "bot_chats"("conversationId");

CREATE INDEX "bot_connections_connectionId_idx" ON "bot_connections"("connectionId");

CREATE INDEX "bot_messages_replyToBotId_answeredAt_idx" ON "bot_messages"("replyToBotId", "answeredAt");

CREATE UNIQUE INDEX "bot_messages_requestId_key" ON "bot_messages"("requestId");

CREATE UNIQUE INDEX "bot_messages_sourceKey_key" ON "bot_messages"("sourceKey");

CREATE INDEX "bot_messages_toBotId_answeredAt_idx" ON "bot_messages"("toBotId", "answeredAt");

CREATE INDEX "bot_skills_skillId_idx" ON "bot_skills"("skillId");

CREATE UNIQUE INDEX "bots_conversationId_key" ON "bots"("conversationId");

CREATE UNIQUE INDEX "connections_slug_key" ON "connections"("slug");

CREATE INDEX "job_logs_jobId_idx" ON "job_logs"("jobId");

CREATE INDEX "job_logs_timestamp_idx" ON "job_logs"("timestamp");

CREATE INDEX "memories_botId_status_category_idx" ON "memories"("botId", "status", "category");

CREATE INDEX "notification_log_createdAt_idx" ON "notification_log"("createdAt");

CREATE INDEX "notification_log_dedupeKey_createdAt_idx" ON "notification_log"("dedupeKey", "createdAt");

CREATE UNIQUE INDEX "passkeys_credentialId_key" ON "passkeys"("credentialId");

CREATE INDEX "passkeys_userId_idx" ON "passkeys"("userId");

CREATE UNIQUE INDEX "routine_runs_requestId_key" ON "routine_runs"("requestId");

CREATE UNIQUE INDEX "routine_runs_routineId_scheduledFor_key" ON "routine_runs"("routineId", "scheduledFor");

CREATE INDEX "routine_runs_status_idx" ON "routine_runs"("status");

CREATE UNIQUE INDEX "routines_conversationId_key" ON "routines"("conversationId");

CREATE INDEX "routines_enabled_nextRunAt_idx" ON "routines"("enabled", "nextRunAt");

CREATE UNIQUE INDEX "routines_pendingJobId_key" ON "routines"("pendingJobId");

CREATE UNIQUE INDEX "routines_sourceKey_key" ON "routines"("sourceKey");

CREATE UNIQUE INDEX "skills_name_key" ON "skills"("name");

CREATE UNIQUE INDEX "tasks_sourceKey_key" ON "tasks"("sourceKey");

CREATE INDEX "tasks_status_dueAt_idx" ON "tasks"("status", "dueAt");

CREATE UNIQUE INDEX "uploads_storageKey_key" ON "uploads"("storageKey");

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

CREATE INDEX "vault_audit_events_at_idx" ON "vault_audit_events"("at");

CREATE INDEX "vault_audit_events_itemId_at_idx" ON "vault_audit_events"("itemId", "at");

CREATE UNIQUE INDEX "vault_items_handle_key" ON "vault_items"("handle");
