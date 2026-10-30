/*
  Routine.blockedStreak and Routine.pausedReason (issue #87): runs in a row
  that ended blocked, and why the app paused the routine after three of
  them. RoutineRun.status gains "blocked" (a string column, no change).
*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_routines" (
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
INSERT INTO "new_routines" ("botId", "conversationId", "createdAt", "enabled", "id", "name", "nextRunAt", "pendingJobId", "prompt", "schedule", "sourceKey", "updatedAt") SELECT "botId", "conversationId", "createdAt", "enabled", "id", "name", "nextRunAt", "pendingJobId", "prompt", "schedule", "sourceKey", "updatedAt" FROM "routines";
DROP TABLE "routines";
ALTER TABLE "new_routines" RENAME TO "routines";
CREATE UNIQUE INDEX "routines_pendingJobId_key" ON "routines"("pendingJobId");
CREATE UNIQUE INDEX "routines_sourceKey_key" ON "routines"("sourceKey");
CREATE UNIQUE INDEX "routines_conversationId_key" ON "routines"("conversationId");
CREATE INDEX "routines_enabled_nextRunAt_idx" ON "routines"("enabled", "nextRunAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
