/**
 * Live events. Two scopes:
 *
 * - **Instance events** (`HarnessInstance.subscribe`): the list changed, a
 *   turn ended, the harness wants the owner's attention, the connection
 *   changed. Cheap; the app always listens.
 * - **Thread events** (`HarnessInstance.watchThread`): one conversation's
 *   transcript, live. The first event is always a full `snapshot`; later
 *   ones upsert rows by id. A reconnect starts again from a snapshot, so
 *   nothing falls between a history read and the stream.
 */
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
  /** Why it is not connected, or what to do (sign in, set an env var). */
  detail?: string;
}

export type InstanceEvent =
  | { type: "status"; status: InstanceStatus }
  /** The thread list changed; re-read it (debounced by the app). */
  | { type: "threads" }
  /** Every (re)connect: missed turn ends must be reconciled. */
  | { type: "connected" }
  /**
   * A turn ended (working went true → false), with where the thread stands
   * as it ended: what `outcome()` answers. `working` is true when the
   * harness already started the next turn (a queued message).
   */
  | { type: "turn_ended"; nativeId: string; outcome: TurnOutcome }
  /** The harness asks for the owner mid-turn (a `message_user` call, an approval). */
  | { type: "attention"; nativeId: string; text: string; key: string };

export type ThreadEvent =
  | { type: "snapshot"; snapshot: ThreadSnapshot }
  | { type: "thread"; thread: ThreadSummary }
  /** Rows added or changed (whole rows, by id). */
  | { type: "items"; items: TranscriptItem[]; cursor: number }
  /** Text and thinking the model is streaming right now (not yet a row). */
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

/** What the app sends a browser about the whole Code page. */
export type CodeListEvent =
  | { type: "status"; instances: Record<InstanceId, InstanceStatus> }
  | { type: "list"; threads: ThreadSummary[] }
  | { type: "ping" }
  | { type: "error"; message: string };

/** What the app sends a browser about one thread. */
export type CodeThreadEvent = ThreadEvent | { type: "ping" } | { type: "moved"; to: ThreadId };
