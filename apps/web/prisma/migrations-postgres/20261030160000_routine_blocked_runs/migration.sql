/*
  Routine.blockedStreak and Routine.pausedReason (issue #87): runs in a row
  that ended blocked, and why the app paused the routine after three of
  them. RoutineRun.status gains "blocked" (a string column, no change).
*/
-- AlterTable
ALTER TABLE "routines" ADD COLUMN     "blockedStreak" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pausedReason" TEXT;
