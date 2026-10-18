-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_bots" (
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
    "toolkits" TEXT NOT NULL DEFAULT '[]',
    "toolPermissions" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_bots" ("avatarColor", "avatarEmoji", "conversationId", "createdAt", "description", "id", "lastActivityAt", "lastMessagePreview", "lastReadAt", "modelId", "name", "systemPrompt", "updatedAt") SELECT "avatarColor", "avatarEmoji", "conversationId", "createdAt", "description", "id", "lastActivityAt", "lastMessagePreview", "lastReadAt", "modelId", "name", "systemPrompt", "updatedAt" FROM "bots";
DROP TABLE "bots";
ALTER TABLE "new_bots" RENAME TO "bots";
CREATE UNIQUE INDEX "bots_conversationId_key" ON "bots"("conversationId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;


-- Existing bots keep the task tools they had before capabilities (issue #1 D2).
UPDATE "bots" SET "toolkits" = '["tasks"]';
