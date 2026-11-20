/**
 * The driver's single live connection to Shelley. One `GET /api/stream2`
 * (Shelley's unified stream: every active conversation's messages, working
 * state, tool output and text deltas, plus conversation-list patches) feeds
 * everything: per-conversation watchers, the conversation list (a cached
 * `/api/conversations/snapshot`, re-read when Shelley says it changed),
 * turn ends and `message_user` calls.
 *
 * The list is re-read rather than patched: Shelley publishes RFC 6902
 * patches several times a second while a turn runs; a debounced snapshot
 * read is simpler than applying them and cheap on a single-user server.
 */
import type { HarnessLogger, InstanceStatus } from "../../contracts";
import { readSseFrames, shelleyFetch, shelleyJson, type ShelleyDeps } from "./client";
import { isWorking, type ShelleyFrame, type ShelleyRow } from "./wire";

interface TurnEnd {
  conversationId: string;
}

export interface StreamOptions {
  deps: ShelleyDeps;
  logger: HarnessLogger;
  /** Snapshot refetch debounce after a list patch. */
  listDebounceMs?: number;
  minBackoffMs?: number;
  maxBackoffMs?: number;
  /** No frame (Shelley heartbeats every 30 s) for this long: reconnect. */
  idleTimeoutMs?: number;
}

export interface ShelleyStream {
  start(): void;
  stop(): void;
  status(): InstanceStatus;
  /** The cached unarchived conversations (subagents included); undefined until first read. */
  list(): ShelleyRow[] | undefined;
  refreshList(): Promise<void>;
  /** Frames for one conversation, or every frame (`null`). */
  subscribe(conversationId: string | null, listener: (frame: ShelleyFrame) => void): () => void;
  onList(listener: () => void): () => void;
  onStatus(listener: (status: InstanceStatus) => void): () => void;
  onTurnEnd(listener: (end: TurnEnd) => void): () => void;
  /** Every (re)connect, after which missed transitions must be reconciled. */
  onConnected(listener: () => void): () => void;
}

export function createShelleyStream(options: StreamOptions): ShelleyStream {
  const { deps, logger } = options;
  const listDebounceMs = options.listDebounceMs ?? 300;
  const minBackoff = options.minBackoffMs ?? 1500;
  const maxBackoff = options.maxBackoffMs ?? 30_000;
  const idleTimeoutMs = options.idleTimeoutMs ?? 75_000;

  let state: InstanceStatus = { state: "disabled" };
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
  const listListeners = new Set<() => void>();
  const statusListeners = new Set<(status: InstanceStatus) => void>();
  const turnEndListeners = new Set<(end: TurnEnd) => void>();
  const connectedListeners = new Set<() => void>();

  function emit<T>(listeners: Set<(value: T) => void>, value: T) {
    for (const listener of listeners) {
      try {
        listener(value);
      } catch (error) {
        logger.warn("A Shelley stream listener failed", { error: String(error) });
      }
    }
  }

  function setStatus(next: InstanceStatus) {
    if (next.state === state.state && next.detail === state.detail) return;
    state = next;
    emit(statusListeners, state);
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
      if (!working.has(row.conversation_id)) working.set(row.conversation_id, isWorking(row));
    }
    emit(listListeners, undefined);
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
          // eslint-disable-next-line react-doctor/async-await-in-loop -- one read at a time
          await readSnapshot();
          // `stopped` is set by stop(), from outside this loop.
          // oxlint-disable-next-line no-unmodified-loop-condition
        } while (refreshAgain && !stopped);
      } catch (error) {
        logger.warn("Could not read Shelley's conversation list", { error: String(error) });
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
      emit(turnEndListeners, { conversationId: id });
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
    // `stopped` is set by stop(), from outside this loop.
    // oxlint-disable-next-line no-unmodified-loop-condition
    while (!stopped) {
      const attempt = new AbortController();
      current = attempt;
      let reason = "the stream ended";
      try {
        setStatus({ state: state.state === "connected" ? "reconnecting" : "connecting" });
        // eslint-disable-next-line react-doctor/async-await-in-loop -- reconnect loop
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
        // eslint-disable-next-line react-doctor/async-await-in-loop -- reconnect loop
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
      setStatus({ state: "reconnecting", detail: reason });
      // eslint-disable-next-line react-doctor/async-await-in-loop -- backoff
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
    onList(listener) {
      listListeners.add(listener);
      return () => listListeners.delete(listener);
    },
    onStatus(listener) {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    onTurnEnd(listener) {
      turnEndListeners.add(listener);
      return () => turnEndListeners.delete(listener);
    },
    onConnected(listener) {
      connectedListeners.add(listener);
      return () => connectedListeners.delete(listener);
    },
  };
}
