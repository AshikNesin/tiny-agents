/**
 * Live refresh for the Changes and Review panels (ADR 0025): while a panel
 * is open on a directory, the server reads that directory's change stamp
 * (HEAD, the status and each changed file's size and time, one cheap git
 * call on the sandbox) every couple of seconds and pushes a new version only
 * when it moved. The panel re-reads on a new version, so it follows the
 * files themselves, not the transcript.
 *
 * - One poll per directory, however many panels watch it.
 * - A read never overlaps the one before (the next is scheduled after it).
 * - Fast while the files move, slower once they have been quiet a while.
 * - It stops when the last panel closes.
 * - A failed read says `unavailable` once (the panel falls back to re-reading
 *   on transcript activity); the next good read sends a new version.
 */
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
  /** The last event sent, given to a panel that opens later. */
  current?: ChangeEvent;
  movedAt: number;
  timer?: ReturnType<typeof setTimeout>;
}

export interface ChangeIntervals {
  /** Between reads while the files move. Default 1.5 s. */
  activeMs: number;
  /** Between reads once they have been quiet for `quietAfterMs`. Default 5 s. */
  idleMs: number;
  quietAfterMs: number;
}

const DEFAULT_INTERVALS: ChangeIntervals = { activeMs: 1_500, idleMs: 5_000, quietAfterMs: 60_000 };

// Intervals are measured on the monotonic clock: tests freeze `Date`.
const now = () => performance.now();

export class CodeChanges {
  private readonly polls = new Map<string, Poll>();
  private readonly intervals: ChangeIntervals;

  constructor(intervals: Partial<ChangeIntervals> = {}) {
    this.intervals = { ...DEFAULT_INTERVALS, ...intervals };
  }

  /**
   * Watch the directory `key` (its stamp is read with `stamp`); the listener
   * gets the current version at once when there is one. Answers the stop.
   */
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
        // The first read sets the baseline; a change, or a read after a failure, is a new version.
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
    // Closed while reading: nothing to tell, nothing to schedule.
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

/** The process's change monitor (`app().codeChanges`), made on first use. */
export function codeChanges(): CodeChanges {
  const root = app();
  return (root.codeChanges ??= new CodeChanges());
}
