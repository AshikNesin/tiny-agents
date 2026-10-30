/*
  Bot.chatStartedAt: when the current chat conversation started, so routine
  run cards from before a "New chat" stay out of the new thread (issue #63).
  Existing bots start at this migration: earlier results stay on the
  Routines page.
*/
-- AlterTable
ALTER TABLE "bots" ADD COLUMN     "chatStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

