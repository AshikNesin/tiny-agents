-- AlterTable
ALTER TABLE "bots" ADD COLUMN     "memoryCapturedThrough" TIMESTAMP(3),
ADD COLUMN     "memoryEnabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "memories" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "source" TEXT NOT NULL DEFAULT 'capture',
    "confidence" DOUBLE PRECISION,
    "until" TIMESTAMP(3),
    "supersededById" TEXT,
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "memories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "memories_botId_status_category_idx" ON "memories"("botId", "status", "category");

-- AddForeignKey
ALTER TABLE "memories" ADD CONSTRAINT "memories_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memories" ADD CONSTRAINT "memories_supersededById_fkey" FOREIGN KEY ("supersededById") REFERENCES "memories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

