const FILLER: readonly string[] = (
  "a an the to for of in on at by with and or but so that this these those it its is are be " +
  "can could would will should you your please pls i we us me my our lets let want need like " +
  "help hey hi ok okay just also some there here when then now currently"
).split(" ");

function joinSlug(words: readonly string[], maxWords: number, maxLength: number): string {
  let slug = "";
  for (const word of words.slice(0, maxWords)) {
    const next = slug ? `${slug}-${word}` : word;
    if (next.length > maxLength) break;
    slug = next;
  }
  return slug || (words[0]?.slice(0, maxLength) ?? "");
}

const wordsOf = (text: string) =>
  text
    .toLowerCase()
    .replace(/['’]/g, "")
    .match(/[a-z0-9]+/g) ?? [];

export function branchSlug(task: string): string {
  const words = wordsOf(task.slice(0, 300));
  const kept = words.filter((word) => !FILLER.includes(word));
  return joinSlug(kept.length ? kept : words, 4, 28) || "thread";
}

export function cleanBranchSlug(raw: string): string | null {
  const line = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .split("\n")
    .map((l) => l.trim())
    .find(Boolean);
  if (!line) return null;
  const name = line.replace(/^(branch(\s+name)?)\s*:\s*/i, "").replace(/^[`'"\s]*ta\//i, "");
  const slug = joinSlug(wordsOf(name), 5, 32);
  return slug.length >= 3 ? slug : null;
}

export const DEFAULT_BRANCH_PREFIX = "ta/";

export const branchName = (prefix: string, slug: string) => `${prefix}${slug}`;

export function cleanBranchPrefix(raw: string): string | null {
  const text = raw.trim();
  if (!text) return "";
  if (!/^[A-Za-z0-9._/-]+$/.test(text)) return null;
  if (/^[/.-]|\.\.|\/\/|\/\.|\.lock(\/|$)/.test(text)) return null;
  return /[/_-]$/.test(text) ? text : `${text}/`;
}
