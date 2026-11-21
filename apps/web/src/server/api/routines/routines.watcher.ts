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
