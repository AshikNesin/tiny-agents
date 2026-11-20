import type { ChatEvent } from "@tiny-agents/agent";
import type { SettledRoutineRunStatus } from "./machines/routine-run";

export interface RoutineRunCard {
  id: string;
  routineId: string;
  routineName: string;
  status: SettledRoutineRunStatus;
  trigger: "schedule" | "manual";
  scheduledFor: string;
  finishedAt: string;
  output: string | null;
  error: string | null;
}

export interface PingEvent {
  type: "ping";
}

export interface StreamErrorEvent {
  type: "error";
  message: string;
}

export type BotStreamEvent =
  | ChatEvent
  | { type: "routine-runs"; runs: RoutineRunCard[] }
  | { type: "routine-run"; run: RoutineRunCard }
  | { type: "yolo"; on: boolean }
  | PingEvent
  | StreamErrorEvent;

export type EventsFeedEvent =
  | { type: "activity"; busy: string[] }
  | {
      type: "activity";
      conversation: string;
      busy: boolean;
      approvals: number;
      questions: number;
    }
  | { type: "connection"; id: string; status: string; error?: string }
  | { type: "models.changed" }
  | PingEvent
  | StreamErrorEvent;
