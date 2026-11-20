import type { SecretValue } from "./vault";

const REDACTED = "[vault]";

const TTL_MS = 24 * 60 * 60_000;

const MIN_LENGTH = 4;

interface Entry {
  forms: string[];
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

  scrub(text: string): string {
    if (this.#entries.size === 0 || !text) return text;
    this.#prune();
    let out = text;
    for (const entry of this.#entries.values()) {
      for (const form of entry.forms) {
        if (out.includes(form)) out = out.split(form).join(REDACTED);
      }
      if (entry.digits) out = out.replace(entry.digits, REDACTED);
    }
    return out;
  }

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

export const secretRedactor = new SecretRedactor();
