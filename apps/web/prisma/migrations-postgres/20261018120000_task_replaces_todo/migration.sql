-- tiny-agents tasks: replace groot's demo Todo with talorys-style tasks
-- (status/priority/due date). Bots manage these from chat via the agent
-- tools; the page is plain REST CRUD.
DROP TABLE IF EXISTS "todos";
DROP TABLE IF EXISTS "Task";
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'todo',
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "dueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "sourceKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "tasks_status_dueAt_idx" ON "tasks"("status", "dueAt");
CREATE UNIQUE INDEX "tasks_sourceKey_key" ON "tasks"("sourceKey");
