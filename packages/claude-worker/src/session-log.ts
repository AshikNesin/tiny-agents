import type { ResumeResult } from "./envelope";

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

  replay(afterSeq: number): Sequenced<E>[] {
    return this.buffer.filter((event) => event.seq > afterSeq);
  }

  get firstSeq(): number {
    return this.buffer[0]?.seq ?? this.seq + 1;
  }

  get lastSeq(): number {
    return this.seq;
  }

  resume(afterSeq: number): ResumeResult {
    return {
      known: true,
      gap: afterSeq < this.firstSeq - 1,
      firstSeq: this.firstSeq,
      lastSeq: this.seq,
    };
  }

  subscribe(listener: SessionLogListener<E>): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export function resumeResultOf(
  log: Pick<SessionLog<unknown>, "resume"> | undefined,
  afterSeq: number,
): ResumeResult {
  return log?.resume(afterSeq) ?? { known: false, gap: false, firstSeq: 1, lastSeq: 0 };
}
