/**
 * Small helpers every driver's normalizer and live feed share. What goes
 * out to watchers, and when, is `feed.ts`; what a turn came to is
 * `outcome.ts`.
 */

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

/** The first of `keys` whose value in `args` is a non-empty string. */
export function pick(args: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value) return value;
  }
  return undefined;
}

/** File names the Code page shows inline as images. */
const IMAGE_FILE = /\.(png|jpe?g|gif|webp|avif|svg)$/i;

export function isImageFile(path: string): boolean {
  return IMAGE_FILE.test(path);
}
