/**
 * A worker session's sequenced event log. Both protocols on the worker
 * socket keep one per session: bot sessions (`sessions.ts`) and coding
 * sessions (`coding.ts`).
 *
 * - `append` numbers an event with the session's next `seq` (from 1, per
 *   worker boot), keeps the last `capacity` events, and hands it to every
 *   subscriber.
 * - `replay` returns the kept events after a client's cursor, and `resume`
 *   answers the `ResumeResult` a resume request replies with before that
 *   replay (`gap` when events after the cursor were already dropped).
 * - Subscribers are the live fan-out: the server subscribes a protocol's
 *   sockets to each session it serves.
 */
import type { ResumeResult } from "./envelope";

/** An event as the worker stores, sends and replays it. */
export interface Sequenced<E> {
  sessionId: string;
  seq: number;
  event: E;
}

export type SessionLogListener<E> = (event: Sequenced<E>) => void;

export class SessionLog<E> {
  private seq = 0;
  private readonly buffer: Sequenced<E>[] = [];
  private readonly listeners = new Set<SessionLogListener<E>>();

  constructor(
    readonly sessionId: string,
    /** Events kept for replay; older ones are dropped. */
    private readonly capacity: number,
  ) {}

  append(event: E): Sequenced<E> {
    this.seq += 1;
    const sequenced: Sequenced<E> = { sessionId: this.sessionId, seq: this.seq, event };
    this.buffer.push(sequenced);
    const extra = this.buffer.length - this.capacity;
    if (extra > 0) this.buffer.splice(0, extra);
    for (const listener of this.listeners) listener(sequenced);
    return sequenced;
  }

  /** The kept events with `seq > afterSeq`, oldest first. */
  replay(afterSeq: number): Sequenced<E>[] {
    return this.buffer.filter((event) => event.seq > afterSeq);
  }

  /** The oldest kept event's seq (the next seq while nothing is kept). */
  get firstSeq(): number {
    return this.buffer[0]?.seq ?? this.seq + 1;
  }

  /** The last seq handed out (0 before the first event). */
  get lastSeq(): number {
    return this.seq;
  }

  /** What a resume from `afterSeq` answers before it replays. */
  resume(afterSeq: number): ResumeResult {
    return {
      known: true,
      gap: afterSeq < this.firstSeq - 1,
      firstSeq: this.firstSeq,
      lastSeq: this.seq,
    };
  }

  /** Follow every appended event. Subscribing the same listener again is a no-op. */
  subscribe(listener: SessionLogListener<E>): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

/** The resume answer for a session's log, or for a session the worker does not hold. */
export function resumeResultOf(
  log: Pick<SessionLog<unknown>, "resume"> | undefined,
  afterSeq: number,
): ResumeResult {
  return log?.resume(afterSeq) ?? { known: false, gap: false, firstSeq: 1, lastSeq: 0 };
}
