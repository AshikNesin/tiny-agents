-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_uploads" (
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
INSERT INTO "new_uploads" ("createdAt", "height", "id", "kind", "mimeType", "modelKey", "name", "size", "storageKey", "width") SELECT "createdAt", "height", "id", "kind", "mimeType", "modelKey", "name", "size", "storageKey", "width" FROM "uploads";
DROP TABLE "uploads";
ALTER TABLE "new_uploads" RENAME TO "uploads";
CREATE UNIQUE INDEX "uploads_storageKey_key" ON "uploads"("storageKey");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
