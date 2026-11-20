import type { InstanceId, ThreadId } from "./ids";
import type { TranscriptItem } from "./items";
import type {
  BackgroundJob,
  QueuedMessage,
  ThreadSettings,
  ThreadSnapshot,
  ThreadSummary,
  TurnOutcome,
} from "./threads";

export type InstanceState = "disabled" | "connecting" | "connected" | "reconnecting";

export interface InstanceStatus {
  state: InstanceState;
  detail?: string;
}

export type InstanceEvent =
  | { type: "status"; status: InstanceStatus }
  | { type: "threads" }
  | { type: "connected" }
  | { type: "turn_ended"; nativeId: string; outcome: TurnOutcome }
  | { type: "attention"; nativeId: string; text: string; key: string };

export type ThreadEvent =
  | { type: "snapshot"; snapshot: ThreadSnapshot }
  | { type: "thread"; thread: ThreadSummary }
  | { type: "items"; items: TranscriptItem[]; cursor: number }
  | { type: "partial"; text: string; thinking: string }
  | {
      type: "state";
      working: boolean;
      context?: { used: number; max?: number };
      queued?: QueuedMessage[];
      jobs?: BackgroundJob[];
      settings?: ThreadSettings;
      costUsd?: number;
    }
  | { type: "error"; message: string };

export type CodeListEvent =
  | { type: "status"; instances: Record<InstanceId, InstanceStatus> }
  | { type: "list"; threads: ThreadSummary[] }
  | { type: "ping" }
  | { type: "error"; message: string };

export type CodeThreadEvent = ThreadEvent | { type: "ping" } | { type: "moved"; to: ThreadId };
