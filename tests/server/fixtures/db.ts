/**
 * App rows for server tests: a bot with a conversation, and a clean slate.
 */
import {
  bots,
  db,
  botChats,
  botConnections,
  botGuests,
  guests,
  botMessages,
  botReleases,
  botSkills,
  connections,
  jobs,
  memories,
  routineRuns,
  routines,
  codeHandoffFinishes,
  codeAutofixPasses,
  codeCheckpoints,
  codeHandoffs,
  codePrEvents,
  codePrComments,
  codeProjects,
  codePullRequests,
  codeReviewDrafts,
  codeReviews,
  codeReviewViewed,
  codeThreads,
  shelleyHandoffs,
  shelleySeen,
  skills,
  tasks,
  uploads,
  vaultAuditEvents,
  vaultItems,
  vaultValues,
} from "../../../apps/web/src/server/db";
import { TEST_MODEL, currentAppRuntime } from "./runtime";

let seeded = 0;
let nextFakeConversation = 1_000;

export type SeededBot = typeof bots.$inferSelect;

/**
 * Insert a bot row. On the real app runtime its conversation is created
 * there (so the bot can be written to); on a fake, or with none installed,
 * it gets a fresh numeric id. Pass `conversationId` to pin one.
 */
export async function seedBot(
  overrides: Partial<typeof bots.$inferInsert> = {},
): Promise<SeededBot> {
  seeded += 1;
  const current = currentAppRuntime();
  const modelId = overrides.modelId ?? (current?.kind === "real" ? TEST_MODEL : "m1");
  const conversationId =
    overrides.conversationId ??
    (current?.kind === "real"
      ? String(
          await current.runtime.createConversation({
            modelId,
            systemPrompt: overrides.systemPrompt ?? "",
          }),
        )
      : String(nextFakeConversation++));
  const [bot] = await db
    .insert(bots)
    .values({ name: `Bot ${seeded}`, ...overrides, modelId, conversationId })
    .returning();
  return bot!;
}

/** Delete every app row, children before parents. */
export async function resetAppTables(): Promise<void> {
  await db.delete(codeHandoffFinishes);
  await db.delete(codeHandoffs);
  await db.delete(codeReviewDrafts);
  await db.delete(codeReviews);
  await db.delete(codeCheckpoints);
  await db.delete(codePrEvents);
  await db.delete(codeReviewViewed);
  await db.delete(codePrComments);
  await db.delete(codeAutofixPasses);
  await db.delete(codePullRequests);
  await db.delete(codeThreads);
  await db.delete(codeProjects);
  await db.delete(shelleyHandoffs);
  await db.delete(shelleySeen);
  await db.delete(routineRuns);
  await db.delete(routines);
  await db.delete(botMessages);
  await db.delete(botChats);
  await db.delete(botSkills);
  await db.delete(botConnections);
  await db.delete(memories);
  await db.delete(uploads);
  await db.delete(jobs);
  await db.delete(skills);
  await db.delete(connections);
  await db.delete(vaultAuditEvents);
  await db.delete(vaultItems);
  await db.delete(vaultValues);
  await db.delete(tasks);
  await db.delete(botGuests);
  await db.delete(guests);
  await db.delete(bots);
  await db.delete(botReleases);
}
