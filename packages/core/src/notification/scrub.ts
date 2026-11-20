export const TITLE_MAX = 80;
export const MESSAGE_MAX = 300;
export const FREE_TEXT_MAX = 200;
const MAX_SCRUBBED_SHARE = 0.2;

type Redactor = (text: string) => string;
const redactors = new Set<Redactor>();

export function registerRedactor(redactor: Redactor): () => void {
  redactors.add(redactor);
  return () => redactors.delete(redactor);
}

const SECRET_PATTERNS: RegExp[] = [
  /\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{8,}/g,
  /\b(?:ghp|gho|ghu|ghs|github_pat|glpat|xox[abprs])[-_][A-Za-z0-9_-]{8,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\b(?:api[_-]?key|secret|password|passwd|token|auth)\s*[:=]\s*\S+/gi,
  /\b[0-9a-f]{32,}\b/gi,
  /[A-Za-z0-9+/_-]{40,}={0,2}/g,
  /\b(?=[A-Za-z0-9]*\d)(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{30}\b/g,
];

const LINK = /\b(?:https?|ftp|file|javascript|data):\/*[^\s<>"']*|\bwww\.[^\s<>"']+/gi;
// oxlint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g;

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

export function shapeTitle(title: string): string {
  return clamp(plainText(title), TITLE_MAX) || "Notification";
}

export function shapeMessage(message: string): string {
  return clamp(plainText(message), MESSAGE_MAX);
}
