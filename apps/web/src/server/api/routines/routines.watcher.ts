/**
 * Routine run completion. A run resolves when the conversation it awaits
 * settles (bots.settled.ts runs `resolveConversation` as one of its steps).
 * At boot, runs left awaiting on idle conversations resolve or are marked
 * interrupted, and armed routines whose fire job is gone are re-armed
 * (routines.chain.ts).
 */
import { logger } from "@groot/core/logger";
import { rearmRoutines } from "./routines.chain";
import {
  createRoutineRunResolver,
  type RoutineRunResolver,
  type RoutineRunsRuntime,
} from "./routines.runs";

export function startRoutinesWatcher(rt: RoutineRunsRuntime): RoutineRunResolver {
  const runs = createRoutineRunResolver(rt);
  void runs.bootSweep().catch(() => undefined);
  void rearmRoutines().catch((error: unknown) =>
    logger.warn({ error }, "Failed to re-arm routines on boot"),
  );
  return runs;
}
