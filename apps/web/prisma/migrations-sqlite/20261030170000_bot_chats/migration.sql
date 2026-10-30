/*
  Past chats (issue #101): bot_chats records each conversation a bot ran on
  before a "New chat", so the owner can read, continue or delete it.
*/
-- CreateTable
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

-- CreateIndex
CREATE UNIQUE INDEX "bot_chats_conversationId_key" ON "bot_chats"("conversationId");

-- CreateIndex
CREATE INDEX "bot_chats_botId_endedAt_idx" ON "bot_chats"("botId", "endedAt");
