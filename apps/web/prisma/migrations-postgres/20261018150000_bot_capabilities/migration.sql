-- AlterTable
ALTER TABLE "bots" ADD COLUMN     "toolPermissions" TEXT NOT NULL DEFAULT '{}',
ADD COLUMN     "toolkits" TEXT NOT NULL DEFAULT '[]';


-- Existing bots keep the task tools they had before capabilities (issue #1 D2).
UPDATE "bots" SET "toolkits" = '["tasks"]';
