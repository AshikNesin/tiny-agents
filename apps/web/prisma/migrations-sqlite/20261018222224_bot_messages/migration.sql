-- CreateTable
CREATE TABLE "bot_messages" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fromBotId" TEXT,
    "toBotId" TEXT NOT NULL,
    "replyToBotId" TEXT,
    "kind" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "sourceKey" TEXT,
    "text" TEXT NOT NULL,
    "answeredAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "bot_messages_fromBotId_fkey" FOREIGN KEY ("fromBotId") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "bot_messages_toBotId_fkey" FOREIGN KEY ("toBotId") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "bot_messages_replyToBotId_fkey" FOREIGN KEY ("replyToBotId") REFERENCES "bots" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "bot_messages_requestId_key" ON "bot_messages"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "bot_messages_sourceKey_key" ON "bot_messages"("sourceKey");

-- CreateIndex
CREATE INDEX "bot_messages_toBotId_answeredAt_idx" ON "bot_messages"("toBotId", "answeredAt");

-- CreateIndex
CREATE INDEX "bot_messages_replyToBotId_answeredAt_idx" ON "bot_messages"("replyToBotId", "answeredAt");
