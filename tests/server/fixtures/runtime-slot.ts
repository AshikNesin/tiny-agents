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
