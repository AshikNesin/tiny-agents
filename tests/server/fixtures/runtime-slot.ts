/**
 * The runtime a test opened or installed through `./runtime`. Kept in a
 * module with no imports, so the setup can read it without loading the agent
 * packages before a file's `vi.mock` calls run.
 */
import type { AgentRuntime } from "../../../packages/agent/src/runtime";

export type CurrentRuntime =
  | { kind: "real"; runtime: AgentRuntime }
  | { kind: "fake"; fake: object };

let current: CurrentRuntime | undefined;

export function currentRuntimeSlot(): CurrentRuntime | undefined {
  return current;
}

export function setCurrentRuntimeSlot(next: CurrentRuntime | undefined): void {
  current = next;
}
