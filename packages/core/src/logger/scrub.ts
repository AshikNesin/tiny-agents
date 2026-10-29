/**
 * A process-wide scrub hook for logs and error reports. The app registers a
 * function that replaces secret values it knows about (a vault redactor);
 * the logger and Sentry run every message and field through it. Without a
 * registered scrubber everything passes through unchanged.
 */

type Scrubber = (text: string) => string;

let scrubber: Scrubber | undefined;

/** Field names whose string values are always replaced, whoever logs them. */
const SECRET_KEYS = new Set([
  "password",
  "secret",
  "cvc",
  "cvv",
  "cardnumber",
  "totp",
  "otp",
  "authorization",
]);

export function setScrubber(fn: Scrubber | undefined): void {
  scrubber = fn;
}

export function scrubText(text: string): string {
  return scrubber ? scrubber(text) : text;
}

/** A copy of `value` with secret-named fields masked and every string scrubbed. */
export function scrubValue<T>(value: T, depth = 0): T {
  if (typeof value === "string") return scrubText(value) as T;
  if (depth > 8 || !value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => scrubValue(item, depth + 1)) as T;
  if (value instanceof Error) return value;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] =
      SECRET_KEYS.has(key.toLowerCase()) && typeof item === "string"
        ? "[REDACTED]"
        : scrubValue(item, depth + 1);
  }
  return out as T;
}
