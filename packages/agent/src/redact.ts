/**
 * The secret redactor (issue #56 D12): every value the vault resolves in this
 * process is registered here before it reaches a sink, with its common
 * encodings, and scrubbed from tool results, transcripts, logs and error
 * reports. A backstop, not the main control: no code path hands a value to
 * anything but a sink in the first place.
 */
import type { SecretValue } from "./vault";

/** What a registered value is replaced with. */
export const REDACTED = "[vault]";

/** A value is kept this long after its last use. */
const TTL_MS = 24 * 60 * 60_000;

/**
 * Values shorter than this are not scrubbed: a 3-digit CVC would turn every
 * "123" in a page into noise. Such values never leave a sink anyway.
 */
const MIN_LENGTH = 4;

interface Entry {
  forms: string[];
  /** Card-like digit runs, matched with or without separators. */
  digits?: RegExp;
  expiresAt: number;
}

function formsOf(value: string): string[] {
  const forms = new Set<string>([value]);
  const utf8 = Buffer.from(value, "utf8");
  forms.add(utf8.toString("base64"));
  forms.add(utf8.toString("base64").replace(/=+$/, ""));
  forms.add(utf8.toString("base64url"));
  forms.add(encodeURIComponent(value));
  forms.add(JSON.stringify(value).slice(1, -1));
  return [...forms].filter((form) => form.length >= MIN_LENGTH).sort((a, b) => b.length - a.length);
}

function digitPattern(value: string): RegExp | undefined {
  const digits = value.replace(/[\s-]/g, "");
  if (!/^\d{12,19}$/.test(digits)) return undefined;
  return new RegExp(digits.split("").join("[\\s-]?"), "g");
}

export class SecretRedactor {
  readonly #entries = new Map<string, Entry>();

  /** Register a value (and its encodings) for scrubbing. */
  register(value: string | SecretValue): void {
    const raw = typeof value === "string" ? value : value.reveal();
    if (raw.length < MIN_LENGTH) return;
    const existing = this.#entries.get(raw);
    const expiresAt = Date.now() + TTL_MS;
    if (existing) {
      existing.expiresAt = expiresAt;
      return;
    }
    this.#entries.set(raw, { forms: formsOf(raw), digits: digitPattern(raw), expiresAt });
  }

  get size(): number {
    this.#prune();
    return this.#entries.size;
  }

  /** `text` with every registered value replaced. */
  scrub(text: string): string {
    if (this.#entries.size === 0 || !text) return text;
    this.#prune();
    let out = text;
    for (const entry of this.#entries.values()) {
      // Longest forms first so a base64 form never leaves a raw tail behind.
      for (const form of entry.forms) {
        if (out.includes(form)) out = out.split(form).join(REDACTED);
      }
      if (entry.digits) out = out.replace(entry.digits, REDACTED);
    }
    return out;
  }

  /** A deep copy of `value` with every string scrubbed. */
  scrubJson<T>(value: T): T {
    if (this.#entries.size === 0) return value;
    const walk = (node: unknown): unknown => {
      if (typeof node === "string") return this.scrub(node);
      if (Array.isArray(node)) return node.map(walk);
      if (node && typeof node === "object" && node.constructor === Object) {
        return Object.fromEntries(Object.entries(node).map(([key, item]) => [key, walk(item)]));
      }
      return node;
    };
    return walk(value) as T;
  }

  /** Test seam: forget every value. */
  clear(): void {
    this.#entries.clear();
  }

  #prune(): void {
    const now = Date.now();
    for (const [key, entry] of this.#entries) {
      if (entry.expiresAt < now) this.#entries.delete(key);
    }
  }
}

/** The process-wide redactor: the vault registers into it, every output path scrubs through it. */
export const secretRedactor = new SecretRedactor();
