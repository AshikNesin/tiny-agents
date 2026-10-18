/**
 * @mention helpers for the composer (issue #12).
 *
 * A mention token is a `@` at the start of the text or right after
 * whitespace, with the query running from the `@` to the caret. The query
 * holds no whitespace, so a mid-word `@` (an email like a@b.com) never
 * triggers.
 */

export interface MentionToken {
  /** Index of the `@` character. */
  start: number;
  /** Text between the `@` and the caret. */
  query: string;
}

/** The token under the caret, or null when the composer has no active mention. */
export function activeMentionToken(text: string, caret: number): MentionToken | null {
  // Walk back from the caret to the nearest `@`. Whitespace on the way
  // means the caret sits in a plain word, not in a mention query.
  for (let i = caret - 1; i >= 0; i--) {
    const ch = text[i]!;
    if (/\s/.test(ch)) return null;
    if (ch === "@") {
      const prev = text[i - 1];
      const atTokenStart = i === 0 || (prev !== undefined && /\s/.test(prev));
      return atTokenStart ? { start: i, query: text.slice(i + 1, caret) } : null;
    }
  }
  return null;
}

/** The roster the autocomplete may offer: every bot except the host. */
export function mentionableBots<T extends { id: string }>(bots: T[], hostId: string): T[] {
  return bots.filter((bot) => bot.id !== hostId);
}

interface MentionCandidate {
  id: string;
  name: string;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * First `@name` occurrence with token boundaries. The `@` must sit at
 * the start of the text or after whitespace (an email like a@b.com never
 * matches); the name must not run into more letters or digits, so
 * "@Adazine" is not a mention of "Ada". Trailing punctuation is fine
 * ("@Ada,"): the autocomplete inserts "@Name ", and a user who deletes
 * the trailing space must not silently lose the tag.
 */
function firstMentionRange(text: string, name: string): { start: number; end: number } | null {
  const match = new RegExp(`(^|\\s)(@${escapeRegExp(name)})(?![\\p{L}\\p{N}_])`, "gu").exec(text);
  if (!match) return null;
  const start = match.index + match[1]!.length;
  return { start, end: start + match[2]!.length };
}

/**
 * Bot ids the final text mentions: an exact, case-sensitive `@Name` with
 * token boundaries. The host never receives its own chat's message, ids
 * dedupe, and a longer name wins over a shorter prefix at the same `@`
 * (tagging "@Pi Helper" does not also ping "Pi").
 */
export function mentionedBotIds(text: string, bots: MentionCandidate[], hostId: string): string[] {
  const found = bots
    .filter((bot) => bot.id !== hostId && bot.name.length > 0)
    .map((bot) => {
      const range = firstMentionRange(text, bot.name);
      return range ? { id: bot.id, start: range.start, length: range.end - range.start } : null;
    })
    .filter((match): match is { id: string; start: number; length: number } => match !== null)
    .sort((a, b) => b.length - a.length);

  const kept: Array<{ id: string; start: number }> = [];
  const claimed = new Set<number>(); // @ positions already taken by a longer name
  for (const match of found) {
    if (claimed.has(match.start)) continue;
    claimed.add(match.start);
    if (!kept.some(({ id }) => id === match.id)) kept.push(match);
  }
  // Longest-name-first claiming scrambles order; report text order.
  kept.sort((a, b) => a.start - b.start);
  return kept.map((match) => match.id);
}
