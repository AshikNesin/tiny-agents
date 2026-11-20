import { app } from "../../app-root";

export type ChangeEvent =
  | { type: "changes"; version: number }
  | { type: "unavailable"; message: string };

type Listener = (event: ChangeEvent) => void;

interface Poll {
  stamp: () => Promise<string>;
  listeners: Set<Listener>;
  version: number;
  last?: string;
  current?: ChangeEvent;
  movedAt: number;
  timer?: ReturnType<typeof setTimeout>;
}

export interface ChangeIntervals {
  activeMs: number;
  idleMs: number;
  quietAfterMs: number;
}

const DEFAULT_INTERVALS: ChangeIntervals = { activeMs: 1_500, idleMs: 5_000, quietAfterMs: 60_000 };

const now = () => performance.now();

export class CodeChanges {
  private readonly polls = new Map<string, Poll>();
  private readonly intervals: ChangeIntervals;

  constructor(intervals: Partial<ChangeIntervals> = {}) {
    this.intervals = { ...DEFAULT_INTERVALS, ...intervals };
  }

  watch(key: string, stamp: () => Promise<string>, listener: Listener): () => void {
    let poll = this.polls.get(key);
    if (!poll) {
      poll = { stamp, listeners: new Set(), version: 0, movedAt: now() };
      this.polls.set(key, poll);
      void this.read(key, poll);
    } else if (poll.current) {
      listener(poll.current);
    }
    poll.listeners.add(listener);
    const owned = poll;
    return () => {
      owned.listeners.delete(listener);
      if (owned.listeners.size > 0 || this.polls.get(key) !== owned) return;
      clearTimeout(owned.timer);
      this.polls.delete(key);
    };
  }

  private async read(key: string, poll: Poll): Promise<void> {
    let event: ChangeEvent | undefined;
    try {
      const stamp = await poll.stamp();
      if (poll.last === undefined || stamp !== poll.last || poll.current?.type !== "changes") {
        if (poll.current) poll.version += 1;
        if (poll.last !== undefined && stamp !== poll.last) poll.movedAt = now();
        poll.last = stamp;
        event = { type: "changes", version: poll.version };
      }
    } catch (error) {
      if (poll.current?.type !== "unavailable") {
        event = {
          type: "unavailable",
          message: error instanceof Error ? error.message : String(error),
        };
      }
    }
    if (this.polls.get(key) !== poll) return;
    if (event) {
      poll.current = event;
      for (const listener of poll.listeners) listener(event);
    }
    const quiet = now() - poll.movedAt > this.intervals.quietAfterMs;
    poll.timer = setTimeout(
      () => void this.read(key, poll),
      quiet ? this.intervals.idleMs : this.intervals.activeMs,
    );
  }
}

export function codeChanges(): CodeChanges {
  const root = app();
  return (root.codeChanges ??= new CodeChanges());
}
