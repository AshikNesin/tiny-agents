-- CreateTable
CREATE TABLE "notification_log" (
    "id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "botId" TEXT,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "priority" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "providerId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "notification_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notification_log_dedupeKey_createdAt_idx" ON "notification_log"("dedupeKey", "createdAt");

-- CreateIndex
CREATE INDEX "notification_log_createdAt_idx" ON "notification_log"("createdAt");

