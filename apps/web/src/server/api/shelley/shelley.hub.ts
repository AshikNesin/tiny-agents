/**
 * ShelleyHub (issue #143): the app's single live connection to Shelley.
 *
 * One `GET /api/stream2` (Shelley's unified stream: every active
 * conversation's messages, working state, tool output and text deltas, plus
 * conversation-list patches) feeds everything here: the Code page's live
 * views (fanned out per conversation), the conversation list (a cached
 * `/api/conversations/snapshot`, refetched when Shelley says the list
 * changed), unread and notifications, and bot hand-offs (turn ends).
 *
 * The list is re-read rather than patched: Shelley publishes RFC 6902
 * patches several times a second while a turn runs; a debounced snapshot
 * read is simpler than applying them, needs no dependency and is cheap on a
 * single-user server.
 */
import { logger } from "@groot/core/logger";
import {
  readSseFrames,
  shelleyFetch,
  shelleyJson,
  type FetchLike,
  type ShelleyConfig,
} from "./shelley.client";

/** A conversation row as Shelley's snapshot serves it (fields we read; the rest pass through). */
export interface ShelleyRow {
  conversation_id: string;
  slug: string | null;
  parent_conversation_id: string | null;
  cwd: string | null;
  model: string | null;
  updated_at: string;
  created_at: string;
  archived?: boolean;
  user_initiated?: boolean;
  working?: boolean;
  agent_working?: boolean;
  max_sequence_id?: number;
  [field: string]: unknown;
}

/** One `stream2` frame (fields the hub reads; the rest pass through to viewers). */
export interface ShelleyFrame {
  conversation_id?: string;
  messages?: Array<{ sequence_id: number; type: string; [field: string]: unknown }>;
  conversation_state?: { conversation_id?: string; working: boolean; model?: string };
  conversation_list_patch?: unknown;
  notification_event?: {
    type?: string;
    conversation_id?: string;
    payload?: { final_response?: string; conversation_title?: string };
  };
  heartbeat?: boolean;
  [field: string]: unknown;
}

export interface TurnEnd {
  conversationId: string;
  /** Shelley's `agent_done` final response, when it sent one (top-level conversations). */
  finalResponse?: string;
}

export type HubState = "disabled" | "connecting" | "connected" | "reconnecting";

export interface HubStatus {
  state: HubState;
  /** Why the last connection failed or ended, while reconnecting. */
  error?: string;
}

export type HubChange = "list" | "status";

export interface ShelleyHub {
  start(): void;
  stop(): void;
  status(): HubStatus;
  /** The cached unarchived conversations (subagents included); undefined until first read. */
  list(): ShelleyRow[] | undefined;
  /** Read the snapshot now (callers that just changed something). */
  refreshList(): Promise<void>;
  /**
   * Frames for one conversation (`conversationId`), or every frame (`null`).
   * A per-conversation subscription counts as a viewer of it.
   */
  subscribe(conversationId: string | null, listener: (frame: ShelleyFrame) => void): () => void;
  /** The list or the connection status changed. */
  onChange(listener: (change: HubChange) => void): () => void;
  /** A conversation's turn ended (working went true → false). */
  onTurnEnd(listener: (end: TurnEnd) => void): () => void;
  /** Every (re)connect, after which missed transitions must be reconciled. */
  onConnected(listener: () => void): () => void;
  /** Open per-conversation subscriptions (a tab showing it). */
  viewers(conversationId: string): number;
}

export interface HubOptions {
  config: ShelleyConfig;
  fetch?: FetchLike;
  /** Snapshot refetch debounce after a list patch. */
  listDebounceMs?: number;
  /** Reconnect backoff bounds. */
  minBackoffMs?: number;
  maxBackoffMs?: number;
  /** No frame (Shelley heartbeats every 30 s) for this long: reconnect. */
  idleTimeoutMs?: number;
}

export function createShelleyHub(options: HubOptions): ShelleyHub {
  const deps = { config: options.config, fetch: options.fetch };
  const listDebounceMs = options.listDebounceMs ?? 300;
  const minBackoff = options.minBackoffMs ?? 1500;
  const maxBackoff = options.maxBackoffMs ?? 30_000;
  const idleTimeoutMs = options.idleTimeoutMs ?? 75_000;

  let state: HubStatus = { state: "disabled" };
  let rows: ShelleyRow[] | undefined;
  let stopped = true;
  let current: AbortController | undefined;
  let wake: (() => void) | undefined;
  let listTimer: ReturnType<typeof setTimeout> | undefined;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let refreshing: Promise<void> | undefined;
  let refreshAgain = false;

  /** Last known working state per conversation, to see true → false. */
  const working = new Map<string, boolean>();
  const byConversation = new Map<string, Set<(frame: ShelleyFrame) => void>>();
  const everyFrame = new Set<(frame: ShelleyFrame) => void>();
  const changeListeners = new Set<(change: HubChange) => void>();
  const turnEndListeners = new Set<(end: TurnEnd) => void>();
  const connectedListeners = new Set<() => void>();

  function emit<T>(listeners: Set<(value: T) => void>, value: T) {
    for (const listener of listeners) {
      try {
        listener(value);
      } catch (error) {
        logger.warn({ error }, "A Shelley hub listener failed");
      }
    }
  }

  function setStatus(next: HubStatus) {
    if (next.state === state.state && next.error === state.error) return;
    state = next;
    emit(changeListeners, "status");
  }

  async function readSnapshot(): Promise<void> {
    const snapshot = await shelleyJson<{ conversations?: ShelleyRow[] }>(
      "/conversations/snapshot",
      {},
      deps,
    );
    rows = Array.isArray(snapshot.conversations) ? snapshot.conversations : [];
    for (const row of rows) {
      // Seed only conversations the stream has not told us about yet: a
      // snapshot read can trail the stream, and overwriting a fresher
      // `working` would hide the true → false a frame is about to report.
      if (!working.has(row.conversation_id)) {
        working.set(row.conversation_id, Boolean(row.working ?? row.agent_working));
      }
    }
    emit(changeListeners, "list");
  }

  /** One snapshot read at a time; a request during a read runs one more after it. */
  function refreshList(): Promise<void> {
    if (refreshing) {
      refreshAgain = true;
      return refreshing;
    }
    refreshing = (async () => {
      try {
        do {
          refreshAgain = false;
          await readSnapshot();
        } while (refreshAgain && !stopped);
      } catch (error) {
        logger.warn({ error }, "Could not read Shelley's conversation list");
      } finally {
        refreshing = undefined;
      }
    })();
    return refreshing;
  }

  function scheduleListRefresh() {
    if (listTimer) return;
    listTimer = setTimeout(() => {
      listTimer = undefined;
      void refreshList();
    }, listDebounceMs);
  }

  function handle(frame: ShelleyFrame) {
    if (frame.conversation_list_patch) scheduleListRefresh();
    const id = frame.conversation_id;
    emit(everyFrame, frame);
    if (!id) return;
    const listeners = byConversation.get(id);
    if (listeners) emit(listeners, frame);

    const nowWorking = frame.conversation_state?.working;
    if (nowWorking === undefined) return;
    const was = working.get(id);
    working.set(id, nowWorking);
    if (was === true && !nowWorking) {
      const done =
        frame.notification_event?.type === "agent_done" ? frame.notification_event : undefined;
      emit(turnEndListeners, { conversationId: id, finalResponse: done?.payload?.final_response });
    }
  }

  function armIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(
      () => current?.abort(new Error("no frames from Shelley")),
      idleTimeoutMs,
    );
    idleTimer.unref?.();
  }

  async function loop() {
    let delay = minBackoff;
    while (!stopped) {
      const attempt = new AbortController();
      current = attempt;
      let reason = "the stream ended";
      try {
        setStatus({ state: state.state === "connected" ? "reconnecting" : "connecting" });
        const response = await shelleyFetch(
          "/stream2",
          { signal: attempt.signal, headers: { Accept: "text/event-stream" } },
          deps,
        );
        if (!response.body) throw new Error("Shelley returned an empty stream");
        setStatus({ state: "connected" });
        delay = minBackoff;
        armIdle();
        void refreshList();
        emit(connectedListeners, undefined);
        await readSseFrames(response.body, (frame) => {
          armIdle();
          handle(frame as ShelleyFrame);
        });
      } catch (error) {
        const abortReason = attempt.signal.reason;
        reason =
          abortReason instanceof Error
            ? abortReason.message
            : error instanceof Error
              ? error.message
              : String(error);
      }
      clearTimeout(idleTimer);
      if (stopped) return;
      setStatus({ state: "reconnecting", error: reason });
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, delay);
        timer.unref?.();
        wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      wake = undefined;
      delay = Math.min(delay * 2, maxBackoff);
    }
  }

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      void loop();
    },
    stop() {
      stopped = true;
      clearTimeout(listTimer);
      clearTimeout(idleTimer);
      listTimer = undefined;
      current?.abort(new Error("stopped"));
      wake?.();
      setStatus({ state: "disabled" });
    },
    status: () => state,
    list: () => rows,
    refreshList,
    subscribe(conversationId, listener) {
      if (conversationId === null) {
        everyFrame.add(listener);
        return () => everyFrame.delete(listener);
      }
      let set = byConversation.get(conversationId);
      if (!set) byConversation.set(conversationId, (set = new Set()));
      set.add(listener);
      return () => {
        const listeners = byConversation.get(conversationId);
        listeners?.delete(listener);
        if (listeners?.size === 0) byConversation.delete(conversationId);
      };
    },
    onChange(listener) {
      changeListeners.add(listener);
      return () => changeListeners.delete(listener);
    },
    onTurnEnd(listener) {
      turnEndListeners.add(listener);
      return () => turnEndListeners.delete(listener);
    },
    onConnected(listener) {
      connectedListeners.add(listener);
      return () => connectedListeners.delete(listener);
    },
    viewers: (conversationId) => byConversation.get(conversationId)?.size ?? 0,
  };
}

let hub: ShelleyHub | undefined;

/** The process's hub, or undefined when Shelley is not configured (set by `startShelleyHub`). */
export function shelleyHub(): ShelleyHub | undefined {
  return hub;
}

/** Install the process's hub (boot); returns it. */
export function setShelleyHub(next: ShelleyHub | undefined): ShelleyHub | undefined {
  hub?.stop();
  hub = next;
  return hub;
}
