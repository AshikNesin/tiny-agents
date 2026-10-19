/*
  Routine.sourceKey: durable tool-call id for exactly-once creates from the
  routines toolkit (issue #18 phase C). Same pattern as Task.sourceKey.
*/
-- AlterTable
ALTER TABLE "routines" ADD COLUMN     "sourceKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "routines_sourceKey_key" ON "routines"("sourceKey");
