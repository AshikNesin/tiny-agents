/**
 * The bot stream's wire contract (GLOSSARY: Bot stream): every event the
 * server writes on `GET /bots/:id/stream` and on the app-wide `GET /events`
 * feed. The server's writes are typed with these, and the client reads them
 * as these, so a new field is one edit here and the compiler finds every
 * reader. Types only: both the server and the browser bundle import it.
 *
 * The transcript events are the agent package's own `ChatEvent`s, sent
 * verbatim; the rest are the app's (routine cards, YOLO mode).
 */
import type { ChatEvent } from "@tiny-agents/agent";

/**
 * A finished routine run, shown as a quiet line in its bot's chat (issue
 * #63) when it finished in the current thread. The run itself happened in
 * the routine's own conversation: the card is not a transcript entry and
 * the bot never reads it. Built from its `RoutineRun` row by
 * `routines.cards.ts`.
 */
export interface RoutineRunCard {
  id: string;
  routineId: string;
  routineName: string;
  /** `blocked`: it finished but could not do its job; `error` says why (issue #87). */
  status: "succeeded" | "blocked" | "failed" | "missed" | "cancelled";
  trigger: "schedule" | "manual";
  /** ISO time of the slot the run was for. */
  scheduledFor: string;
  /** ISO time the run finished. */
  finishedAt: string;
  output: string | null;
  error: string | null;
}

/** Sent every 25 s on every stream so proxies keep it open. */
export interface PingEvent {
  type: "ping";
}

/** The stream failed after it opened; it ends right after this. */
export interface StreamErrorEvent {
  type: "error";
  message: string;
}

/**
 * One bot's chat, live (`GET /bots/:id/stream`, `followBotChat` on the
 * server): a transcript snapshot of the newest messages, then its changes;
 * the chat's routine cards (all of them, then each new one); and its YOLO
 * mode (now, then each switch). The stream ends when the bot moves to
 * another chat; the client reconnects onto the new one.
 */
export type BotStreamEvent =
  | ChatEvent
  | { type: "routine-runs"; runs: RoutineRunCard[] }
  | { type: "routine-run"; run: RoutineRunCard }
  | { type: "yolo"; on: boolean }
  | PingEvent
  | StreamErrorEvent;

/**
 * The app-wide feed (`GET /events`): which conversations are replying (all
 * of them on open, then each change, with its waiting counts) and the live
 * state of MCP connections.
 */
export type EventsFeedEvent =
  | { type: "activity"; busy: string[] }
  | {
      type: "activity";
      conversation: string;
      busy: boolean;
      /** Tool calls waiting for the owner's approval. */
      approvals: number;
      /** `ask_owner` calls waiting for the owner's answers. */
      questions: number;
    }
  | { type: "connection"; id: string; status: string; error?: string }
  | PingEvent
  | StreamErrorEvent;
