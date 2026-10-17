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
    "lastReadAt" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessagePreview" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "bots_conversationId_key" ON "bots"("conversationId");
