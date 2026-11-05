/**
 * Helpers drivers share for live transcripts: rows are re-derived from the
 * harness's messages and only the rows that changed are sent on.
 */
import type { TranscriptItem } from "../contracts";

/** Remembers what a watcher was last sent and answers what changed since. */
export class ItemTracker {
  private readonly sent = new Map<string, string>();

  /** Rows that are new or differ from the last call (in transcript order). */
  changed(items: readonly TranscriptItem[]): TranscriptItem[] {
    const out: TranscriptItem[] = [];
    for (const item of items) {
      const json = JSON.stringify(item);
      if (this.sent.get(item.id) === json) continue;
      this.sent.set(item.id, json);
      out.push(item);
    }
    return out;
  }

  /** Forget everything (a new snapshot was sent). */
  reset(items: readonly TranscriptItem[] = []): void {
    this.sent.clear();
    for (const item of items) this.sent.set(item.id, JSON.stringify(item));
  }
}

/** Listener sets that never let one failing listener stop the others. */
export class Emitter<T> {
  private readonly listeners = new Set<(value: T) => void>();

  constructor(private readonly onError?: (error: unknown) => void) {}

  add(listener: (value: T) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(value: T): void {
    for (const listener of this.listeners) {
      try {
        listener(value);
      } catch (error) {
        this.onError?.(error);
      }
    }
  }

  get size(): number {
    return this.listeners.size;
  }
}

/** The one-line gist of a value: first line, trimmed to `max`. */
export function firstLine(value: string, max = 140): string {
  const line = value.split("\n")[0]?.trim() ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

export function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Trim to a chat-sized excerpt. */
export function excerpt(text: string, max = 1500): string {
  const clean = text.trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}
