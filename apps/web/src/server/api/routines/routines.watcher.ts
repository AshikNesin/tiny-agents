/**
 * Routine run completion, as a step of the settled pipeline (bots.settled.ts):
 * a run resolves when the conversation it awaits settles. Its boot sweep,
 * which the pipeline runs once it is subscribed, resolves or marks
 * interrupted the runs left awaiting on idle conversations, and re-arms
 * armed routines whose fire job is gone (routines.arming.ts).
 */
import { logger } from "@groot/core/logger";
import type { SettledStep } from "../bots/bots.settled";
import { rearmRoutines } from "./routines.arming";
import { createRoutineRunResolver, type RoutineRunsRuntime } from "./routines.runs";

export function routineRunsStep(rt: RoutineRunsRuntime): SettledStep {
  const runs = createRoutineRunResolver(rt);
  return {
    name: "routine runs",
    run: ({ conversationId, chat }) => runs.resolveConversation(conversationId, chat),
    async sweep() {
      await Promise.all([
        runs.bootSweep(),
        rearmRoutines().catch((error: unknown) =>
          logger.warn({ error }, "Failed to re-arm routines on boot"),
        ),
      ]);
    },
  };
}
