/**
 * Routine run completion, as a step of the settled pipeline (bots.settled.ts):
 * a run resolves when the conversation it awaits settles. Its boot sweep,
 * which the pipeline runs once it is subscribed, resolves or marks
 * interrupted the runs left awaiting on idle conversations. Re-arming armed
 * routines whose fire job is gone is the boot's own part ("routine re-arm",
 * entry.node.ts), not a settling step.
 */
import type { SettledStep } from "../bots/bots.settled";
import { createRoutineRunResolver, type RoutineRunsRuntime } from "./routines.runs";

export function routineRunsStep(rt: RoutineRunsRuntime): SettledStep {
  const runs = createRoutineRunResolver(rt);
  return {
    name: "routine runs",
    run: ({ conversationId, chat }) => runs.resolveConversation(conversationId, chat),
    async sweep() {
      await runs.bootSweep();
    },
  };
}
