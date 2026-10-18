/*
  Warnings:

  - You are about to drop the column `avatarColor` on the `bots` table. All the data in the column will be lost.
  - You are about to drop the column `avatarEmoji` on the `bots` table. All the data in the column will be lost.

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
    "lastReadAt" DATETIME,
    "lastActivityAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessagePreview" TEXT,
    "toolkits" TEXT NOT NULL DEFAULT '[]',
    "toolPermissions" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_bots" ("conversationId", "createdAt", "description", "id", "lastActivityAt", "lastMessagePreview", "lastReadAt", "modelId", "name", "systemPrompt", "toolPermissions", "toolkits", "updatedAt") SELECT "conversationId", "createdAt", "description", "id", "lastActivityAt", "lastMessagePreview", "lastReadAt", "modelId", "name", "systemPrompt", "toolPermissions", "toolkits", "updatedAt" FROM "bots";
DROP TABLE "bots";
ALTER TABLE "new_bots" RENAME TO "bots";
CREATE UNIQUE INDEX "bots_conversationId_key" ON "bots"("conversationId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
