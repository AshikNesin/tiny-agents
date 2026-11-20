import type { ThreadEvent, ThreadSnapshot, ThreadSummary, TranscriptItem } from "../contracts";

export type ThreadListener = (event: ThreadEvent) => void;

export interface PartialText {
  text: string;
  thinking: string;
}

export type StatePatch = Omit<Extract<ThreadEvent, { type: "state" }>, "type" | "working"> & {
  working?: boolean;
};

export const NO_PARTIAL: Readonly<PartialText> = Object.freeze({ text: "", thinking: "" });

interface Subscriber {
  listener: ThreadListener;
  sent: Map<string, string> | undefined;
}

export class ThreadFeed {
  private readonly subscribers = new Set<Subscriber>();
  private working = false;
  private streaming: PartialText = NO_PARTIAL;

  constructor(private readonly onError?: (error: unknown) => void) {}

  subscribe(listener: ThreadListener): () => void {
    const subscriber: Subscriber = { listener, sent: undefined };
    this.subscribers.add(subscriber);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  get size(): number {
    return this.subscribers.size;
  }

  get live(): boolean {
    for (const subscriber of this.subscribers) if (subscriber.sent) return true;
    return false;
  }

  get waiting(): boolean {
    for (const subscriber of this.subscribers) if (!subscriber.sent) return true;
    return false;
  }

  get partialNow(): Readonly<PartialText> {
    return this.streaming;
  }

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

  partial(next: PartialText): void {
    if (next.text === this.streaming.text && next.thinking === this.streaming.thinking) return;
    this.streaming = { text: next.text, thinking: next.thinking };
    this.broadcast({ type: "partial", ...this.streaming });
  }

  state(patch: StatePatch): void {
    const { working = this.working, ...rest } = patch;
    this.working = working;
    if (!working) this.streaming = NO_PARTIAL;
    this.broadcast({ type: "state", working, ...rest });
  }

  thread(thread: ThreadSummary): void {
    this.broadcast({ type: "thread", thread });
  }

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
    if (!this.subscribers.has(subscriber)) return;
    try {
      subscriber.listener(event);
    } catch (error) {
      this.onError?.(error);
    }
  }
}
