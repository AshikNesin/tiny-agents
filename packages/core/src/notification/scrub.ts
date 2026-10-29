/**
 * Content rules for notification text. Everything that leaves in a push is
 * plain text with no control characters and no links (the notification's own
 * `url` is the only link). Free text (question previews, routine output,
 * error reasons) is also run through registered redactors (known secret
 * values) and a pattern scrubber, then truncated; a field the scrubber had to
 * rewrite heavily is dropped entirely.
 */

export const TITLE_MAX = 80;
export const MESSAGE_MAX = 300;
export const FREE_TEXT_MAX = 200;
/** Drop a field when more than this share of it was scrubbed. */
const MAX_SCRUBBED_SHARE = 0.2;

type Redactor = (text: string) => string;
const redactors = new Set<Redactor>();

/**
 * Register a redactor for free text, e.g. one that replaces registered vault
 * values with `[redacted]`. Returns the unregister function.
 */
export function registerRedactor(redactor: Redactor): () => void {
  redactors.add(redactor);
  return () => redactors.delete(redactor);
}

const SECRET_PATTERNS: RegExp[] = [
  // Authorization headers and bearer tokens.
  /\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  // Common API key shapes: sk-…, ghp_…, xoxb-…, AKIA…
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{8,}/g,
  /\b(?:ghp|gho|ghu|ghs|github_pat|glpat|xox[abprs])[-_][A-Za-z0-9_-]{8,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  // key=value / key: value pairs naming a secret.
  /\b(?:api[_-]?key|secret|password|passwd|token|auth)\s*[:=]\s*\S+/gi,
  // Long hex runs (hashes, keys) and long base64-ish runs.
  /\b[0-9a-f]{32,}\b/gi,
  /[A-Za-z0-9+/_-]{40,}={0,2}/g,
  // Pushover-like 30-char keys (letters and digits mixed).
  /\b(?=[A-Za-z0-9]*\d)(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{30}\b/g,
];

const LINK = /\b(?:https?|ftp|file|javascript|data):\/*[^\s<>"']*|\bwww\.[^\s<>"']+/gi;
// C0/C1 controls, zero-width and bidi overrides.
// oxlint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g;

/** Plain, single-line text: controls stripped, whitespace collapsed. */
export function plainText(text: string): string {
  return text.replace(CONTROL, " ").replace(/\s+/g, " ").trim();
}

export function clamp(text: string, max: number): string {
  const chars = [...text];
  return chars.length <= max
    ? text
    : `${chars
        .slice(0, max - 1)
        .join("")
        .trimEnd()}…`;
}

/**
 * Untrusted free text, made safe for a notification: plain, without links,
 * redacted, scrubbed of secret-looking runs and at most `max` chars.
 * Undefined when nothing is left or when scrubbing rewrote more than 20%.
 */
export function scrubText(
  input: string | undefined | null,
  max: number = FREE_TEXT_MAX,
): string | undefined {
  if (!input) return undefined;
  let text = plainText(input);
  if (!text) return undefined;
  for (const redactor of redactors) {
    try {
      text = redactor(text);
    } catch {
      // a failing redactor must not leak the text either
      return undefined;
    }
  }
  text = text.replace(LINK, "[link]");
  const before = text.length;
  let scrubbed = 0;
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, (match) => {
      scrubbed += match.length;
      return "[redacted]";
    });
  }
  if (before > 0 && scrubbed / before > MAX_SCRUBBED_SHARE) return undefined;
  text = text.trim();
  return text ? clamp(text, max) : undefined;
}

/** A title or message the app built from its own template: plain and clamped. */
export function shapeTitle(title: string): string {
  return clamp(plainText(title), TITLE_MAX) || "Notification";
}

export function shapeMessage(message: string): string {
  return clamp(plainText(message), MESSAGE_MAX);
}
