-- tiny-agents bots: one row per bot; the current pi-durable conversation is
-- linked by conversationId (agent.db owns the transcript itself).
CREATE TABLE "bots" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "systemPrompt" TEXT NOT NULL DEFAULT '',
    "modelId" TEXT NOT NULL,
    "avatarEmoji" TEXT,
    "avatarColor" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "lastReadAt" DATETIME,
    "lastActivityAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessagePreview" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "bots_conversationId_key" ON "bots"("conversationId");
