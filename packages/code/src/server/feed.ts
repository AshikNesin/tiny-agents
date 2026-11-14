/**
 * The watch-thread protocol (`ThreadEvent`, `contracts/events.ts`), in one
 * place. A driver tells its feed what the thread is now: a full snapshot,
 * the full row list, the streaming text, a state change, and the feed
 * decides what each watcher is sent:
 *
 * - a watcher gets nothing but errors until a snapshot reaches it;
 * - rows go out whole, and only those that changed since what that watcher
 *   last saw (its snapshot resets this);
 * - the streaming text is re-sent right after a snapshot, while the thread
 *   is working, since a snapshot clears it on the receiving end;
 * - a listener that throws is reported and never stops the others.
 */
import type { ThreadEvent, ThreadSnapshot, ThreadSummary, TranscriptItem } from "../contracts";

export type ThreadListener = (event: ThreadEvent) => void;

export interface PartialText {
  text: string;
  thinking: string;
}

/** A `state` event's fields; `working` defaults to the last one the feed saw. */
export type StatePatch = Omit<Extract<ThreadEvent, { type: "state" }>, "type" | "working"> & {
  working?: boolean;
};

export const NO_PARTIAL: Readonly<PartialText> = Object.freeze({ text: "", thinking: "" });

interface Subscriber {
  listener: ThreadListener;
  /** What this watcher was last sent, by row id (JSON); undefined until its snapshot. */
  sent: Map<string, string> | undefined;
}

export class ThreadFeed {
  private readonly subscribers = new Set<Subscriber>();
  private working = false;
  private streaming: PartialText = NO_PARTIAL;

  /** `onError` hears about listeners that threw. */
  constructor(private readonly onError?: (error: unknown) => void) {}

  /**
   * Add a watcher. It waits for the next snapshot (`snapshot()`); until then
   * it hears only errors. Returns the unsubscribe.
   */
  subscribe(listener: ThreadListener): () => void {
    const subscriber: Subscriber = { listener, sent: undefined };
    this.subscribers.add(subscriber);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  /** Watchers, live or waiting for their snapshot. */
  get size(): number {
    return this.subscribers.size;
  }

  /** Whether any watcher has had its snapshot (so rows and state reach someone). */
  get live(): boolean {
    for (const subscriber of this.subscribers) if (subscriber.sent) return true;
    return false;
  }

  /** Whether any watcher is still waiting for its snapshot. */
  get waiting(): boolean {
    for (const subscriber of this.subscribers) if (!subscriber.sent) return true;
    return false;
  }

  /** The streaming text the feed holds now (drivers append deltas to it). */
  get partialNow(): Readonly<PartialText> {
    return this.streaming;
  }

  /**
   * The whole thread as of now. Every watcher starts over from it, or with
   * `"waiting"` only those that have had none yet (one more viewer joined).
   * The streaming text follows while the thread works.
   */
  snapshot(snapshot: ThreadSnapshot, to: "all" | "waiting" = "all"): void {
    this.working = snapshot.thread.working;
    if (!this.working) this.streaming = NO_PARTIAL;
    const rows = new Map(snapshot.items.map((item) => [item.id, JSON.stringify(item)]));
    const partial = this.streaming.text || this.streaming.thinking ? this.streaming : undefined;
    for (const subscriber of this.subscribers) {
      if (to === "waiting" && subscriber.sent) continue;
      subscriber.sent = new Map(rows);
      this.deliver(subscriber, { type: "snapshot", snapshot });
      if (partial) this.deliver(subscriber, { type: "partial", ...partial });
    }
  }

  /**
   * The full row list now, in transcript order. Each live watcher gets the
   * rows that are new or changed for it, whole; nothing when none changed.
   */
  items(all: readonly TranscriptItem[], cursor: number): void {
    if (!this.live) return;
    const rows = all.map((item) => ({ item, json: JSON.stringify(item) }));
    for (const subscriber of this.subscribers) {
      const sent = subscriber.sent;
      if (!sent) continue;
      const changed: TranscriptItem[] = [];
      for (const { item, json } of rows) {
        if (sent.get(item.id) === json) continue;
        sent.set(item.id, json);
        changed.push(item);
      }
      if (changed.length > 0) this.deliver(subscriber, { type: "items", items: changed, cursor });
    }
  }

  /** The text and thinking streaming now (the whole of it, not a delta). Sent when it changed. */
  partial(next: PartialText): void {
    if (next.text === this.streaming.text && next.thinking === this.streaming.thinking) return;
    this.streaming = { text: next.text, thinking: next.thinking };
    this.broadcast({ type: "partial", ...this.streaming });
  }

  /**
   * A state change. `working` may be left out (the last one is kept); when
   * it goes false the streaming text ends with it, as it does for watchers.
   */
  state(patch: StatePatch): void {
    const { working = this.working, ...rest } = patch;
    this.working = working;
    if (!working) this.streaming = NO_PARTIAL;
    this.broadcast({ type: "state", working, ...rest });
  }

  /** The thread's summary changed (title, cursor, …). */
  thread(thread: ThreadSummary): void {
    this.broadcast({ type: "thread", thread });
  }

  /** Something went wrong; every watcher hears it, even one still waiting. */
  error(message: string): void {
    for (const subscriber of this.subscribers) {
      this.deliver(subscriber, { type: "error", message });
    }
  }

  private broadcast(event: ThreadEvent): void {
    for (const subscriber of this.subscribers) {
      if (subscriber.sent) this.deliver(subscriber, event);
    }
  }

  private deliver(subscriber: Subscriber, event: ThreadEvent): void {
    // It left while hearing an earlier event of this same call (a snapshot's partial).
    if (!this.subscribers.has(subscriber)) return;
    try {
      subscriber.listener(event);
    } catch (error) {
      this.onError?.(error);
    }
  }
}
