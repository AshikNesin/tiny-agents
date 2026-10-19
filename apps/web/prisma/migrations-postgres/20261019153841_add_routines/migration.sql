-- CreateTable
CREATE TABLE "routines" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "schedule" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "nextRunAt" TIMESTAMP(3),
    "pendingJobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "routines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routine_runs" (
    "id" TEXT NOT NULL,
    "routineId" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "trigger" TEXT NOT NULL DEFAULT 'schedule',
    "requestId" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "output" TEXT,
    "error" TEXT,

    CONSTRAINT "routine_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "routines_pendingJobId_key" ON "routines"("pendingJobId");

-- CreateIndex
CREATE INDEX "routines_enabled_nextRunAt_idx" ON "routines"("enabled", "nextRunAt");

-- CreateIndex
CREATE UNIQUE INDEX "routine_runs_requestId_key" ON "routine_runs"("requestId");

-- CreateIndex
CREATE INDEX "routine_runs_status_idx" ON "routine_runs"("status");

-- CreateIndex
CREATE UNIQUE INDEX "routine_runs_routineId_scheduledFor_key" ON "routine_runs"("routineId", "scheduledFor");

-- AddForeignKey
ALTER TABLE "routines" ADD CONSTRAINT "routines_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routine_runs" ADD CONSTRAINT "routine_runs_routineId_fkey" FOREIGN KEY ("routineId") REFERENCES "routines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
