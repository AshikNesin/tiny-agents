/*
  Bot.chatStartedAt: when the current chat conversation started, so routine
  run cards from before a "New chat" stay out of the new thread (issue #63).
  Existing bots start at this migration: earlier results stay on the
  Routines page.
*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_bots" (
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
INSERT INTO "new_bots" ("autoReview", "browserProfile", "conversationId", "createdAt", "description", "id", "lastActivityAt", "lastMessagePreview", "lastReadAt", "memoryCapturedThrough", "memoryEnabled", "modelId", "name", "pinnedAt", "systemPrompt", "toolPermissions", "updatedAt") SELECT "autoReview", "browserProfile", "conversationId", "createdAt", "description", "id", "lastActivityAt", "lastMessagePreview", "lastReadAt", "memoryCapturedThrough", "memoryEnabled", "modelId", "name", "pinnedAt", "systemPrompt", "toolPermissions", "updatedAt" FROM "bots";
DROP TABLE "bots";
ALTER TABLE "new_bots" RENAME TO "bots";
CREATE UNIQUE INDEX "bots_conversationId_key" ON "bots"("conversationId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

