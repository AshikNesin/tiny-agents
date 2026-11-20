export interface MentionToken {
  start: number;
  query: string;
}

export function activeMentionToken(text: string, caret: number): MentionToken | null {
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

function mentionRanges(text: string, name: string): Array<{ start: number; length: number }> {
  const ranges = new Map<number, number>();
  for (const candidate of new Set([name, name.toLowerCase()])) {
    const pattern = `(^|\\s)(@${escapeRegExp(candidate)})(?![\\p{L}\\p{N}_])`;
    for (const match of text.matchAll(new RegExp(pattern, "gu"))) {
      ranges.set(match.index + match[1]!.length, match[2]!.length);
    }
  }
  return [...ranges].map(([start, length]) => ({ start, length }));
}

export interface PickedMention {
  start: number;
  botId: string;
  name: string;
}

export function trackPickedMentions(
  prev: string,
  next: string,
  picked: PickedMention[],
): PickedMention[] {
  if (picked.length === 0 || prev === next) return picked;
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

function pickStillInText(text: string, pick: PickedMention): boolean {
  const end = pick.start + 1 + pick.name.length;
  if (text.slice(pick.start, end) !== `@${pick.name}`) return false;
  const before = text[pick.start - 1];
  if (before !== undefined && !/\s/.test(before)) return false;
  const after = text[end];
  return after === undefined || !/[\p{L}\p{N}_]/u.test(after);
}

export interface MentionResolution {
  ids: string[];
  ambiguous: string[];
}

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
  const claimed = new Set<number>();

  for (const pick of picked) {
    if (claimed.has(pick.start) || !pickStillInText(text, pick)) continue;
    if (!roster.some((bot) => bot.id === pick.botId)) continue;
    claimed.add(pick.start);
    keep(pick.botId, pick.start);
  }

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
  kept.sort((a, b) => a.start - b.start);
  return { ids: kept.map((match) => match.id), ambiguous };
}

export function mentionedBotIds(
  text: string,
  bots: MentionCandidate[],
  hostId: string,
  picked: PickedMention[] = [],
): string[] {
  return resolveMentions(text, bots, hostId, picked).ids;
}
