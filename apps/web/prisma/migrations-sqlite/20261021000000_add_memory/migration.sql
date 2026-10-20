-- CreateTable
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
    "memoryEnabled" BOOLEAN NOT NULL DEFAULT true,
    "memoryCapturedThrough" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_bots" ("conversationId", "createdAt", "description", "id", "lastActivityAt", "lastMessagePreview", "lastReadAt", "modelId", "name", "systemPrompt", "toolPermissions", "toolkits", "updatedAt") SELECT "conversationId", "createdAt", "description", "id", "lastActivityAt", "lastMessagePreview", "lastReadAt", "modelId", "name", "systemPrompt", "toolPermissions", "toolkits", "updatedAt" FROM "bots";
DROP TABLE "bots";
ALTER TABLE "new_bots" RENAME TO "bots";
CREATE UNIQUE INDEX "bots_conversationId_key" ON "bots"("conversationId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "memories_botId_status_category_idx" ON "memories"("botId", "status", "category");

