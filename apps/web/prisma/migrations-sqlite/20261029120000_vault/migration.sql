-- AlterTable
ALTER TABLE "connections" ADD COLUMN "secretRef" TEXT;

-- CreateTable
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

-- CreateTable
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

-- CreateIndex
CREATE UNIQUE INDEX "vault_items_handle_key" ON "vault_items"("handle");

-- CreateIndex
CREATE INDEX "vault_audit_events_itemId_at_idx" ON "vault_audit_events"("itemId", "at");

-- CreateIndex
CREATE INDEX "vault_audit_events_at_idx" ON "vault_audit_events"("at");

