/*
  Routine.conversationId: each routine runs in a durable conversation of its
  own instead of the bot's chat (issue #63). Created on first fire.
*/
-- AlterTable
ALTER TABLE "routines" ADD COLUMN     "conversationId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "routines_conversationId_key" ON "routines"("conversationId");
