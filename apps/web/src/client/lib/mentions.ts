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
 * Every `@name` occurrence with token boundaries. The `@` must sit at the
 * start of the text or after whitespace (an email like a@b.com never
 * matches); the name must not run into more letters or digits, so
 * "@Adazine" is not a mention of "Ada". Trailing punctuation is fine
 * ("@Ada,"): the autocomplete inserts "@Name ", and a user who deletes
 * the trailing space must not silently lose the tag.
 */
function mentionRanges(text: string, name: string): Array<{ start: number; length: number }> {
  // Exact case (the autocomplete always inserts the exact name), plus a
  // hand-typed "@ada" for "Ada" so a near-miss tag is not silently dropped.
  // Token boundaries in both cases ("@Adazine" is not "@Ada").
  const ranges = new Map<number, number>();
  for (const candidate of new Set([name, name.toLowerCase()])) {
    const pattern = `(^|\\s)(@${escapeRegExp(candidate)})(?![\\p{L}\\p{N}_])`;
    for (const match of text.matchAll(new RegExp(pattern, "gu"))) {
      ranges.set(match.index + match[1]!.length, match[2]!.length);
    }
  }
  return [...ranges].map(([start, length]) => ({ start, length }));
}

/**
 * A mention picked from the autocomplete (issue #80): which bot, and where
 * its `@Name` sits in the composer text. Names need not be unique in older
 * data, so the pick, not the text, says who is meant.
 */
export interface PickedMention {
  /** Index of the `@` character. */
  start: number;
  botId: string;
  name: string;
}

/**
 * Carry picked mentions across an edit from `prev` to `next`: picks before
 * the edit stay, picks after it shift, and a pick the edit touches is
 * dropped (its text is no longer what was picked; name matching takes over).
 */
export function trackPickedMentions(
  prev: string,
  next: string,
  picked: PickedMention[],
): PickedMention[] {
  if (picked.length === 0 || prev === next) return picked;
  // The edit is whatever lies between the common prefix and suffix.
  let head = 0;
  const shortest = Math.min(prev.length, next.length);
  while (head < shortest && prev[head] === next[head]) head++;
  let tail = 0;
  while (tail < shortest - head && prev[prev.length - 1 - tail] === next[next.length - 1 - tail]) {
    tail++;
  }
  const editEnd = prev.length - tail;
  const delta = next.length - prev.length;
  return picked.flatMap((pick) => {
    const end = pick.start + 1 + pick.name.length;
    if (end <= head) return [pick];
    if (pick.start >= editEnd) return [{ ...pick, start: pick.start + delta }];
    return [];
  });
}

/** The pick's `@Name` is still in the text, whole, with token boundaries. */
function pickStillInText(text: string, pick: PickedMention): boolean {
  const end = pick.start + 1 + pick.name.length;
  if (text.slice(pick.start, end) !== `@${pick.name}`) return false;
  const before = text[pick.start - 1];
  if (before !== undefined && !/\s/.test(before)) return false;
  const after = text[end];
  return after === undefined || !/[\p{L}\p{N}_]/u.test(after);
}

export interface MentionResolution {
  /** Bot ids to deliver to, in text order. */
  ids: string[];
  /** Typed names that more than one bot answers to; the owner must pick one. */
  ambiguous: string[];
}

/**
 * Resolve the final text's mentions to bot ids. A mention picked from the
 * autocomplete goes to the bot picked (issue #80); a typed `@Name` falls
 * back to name matching, exact case first with a case-insensitive fallback.
 * The host never receives its own chat's message, ids dedupe, and a longer
 * name wins over a shorter prefix at the same `@` (tagging "@Pi Helper"
 * does not also ping "Pi"). A typed name several bots share is reported as
 * ambiguous and sent to none of them.
 */
export function resolveMentions(
  text: string,
  bots: MentionCandidate[],
  hostId: string,
  picked: PickedMention[] = [],
): MentionResolution {
  const roster = bots.filter((bot) => bot.id !== hostId && bot.name.length > 0);
  const kept: Array<{ id: string; start: number }> = [];
  const keep = (id: string, start: number) => {
    const seen = kept.find((match) => match.id === id);
    if (!seen) kept.push({ id, start });
    else seen.start = Math.min(seen.start, start);
  };
  const claimed = new Set<number>(); // @ positions already settled

  for (const pick of picked) {
    if (claimed.has(pick.start) || !pickStillInText(text, pick)) continue;
    if (!roster.some((bot) => bot.id === pick.botId)) continue;
    claimed.add(pick.start);
    keep(pick.botId, pick.start);
  }

  // Typed mentions: per `@`, the longest names that match there.
  const found = roster
    .flatMap((bot) => mentionRanges(text, bot.name).map((range) => ({ ...range, bot })))
    .filter((match) => !claimed.has(match.start))
    .sort((a, b) => b.length - a.length);
  const ambiguous: string[] = [];
  for (const match of found) {
    if (claimed.has(match.start)) continue;
    claimed.add(match.start);
    const rivals = found.filter(
      (other) => other.start === match.start && other.length === match.length,
    );
    if (new Set(rivals.map((rival) => rival.bot.id)).size > 1) {
      if (!ambiguous.includes(match.bot.name)) ambiguous.push(match.bot.name);
      continue;
    }
    keep(match.bot.id, match.start);
  }
  // Longest-name-first claiming scrambles order; report text order.
  kept.sort((a, b) => a.start - b.start);
  return { ids: kept.map((match) => match.id), ambiguous };
}

/** Bot ids the final text mentions; see `resolveMentions`. */
export function mentionedBotIds(
  text: string,
  bots: MentionCandidate[],
  hostId: string,
  picked: PickedMention[] = [],
): string[] {
  return resolveMentions(text, bots, hostId, picked).ids;
}
