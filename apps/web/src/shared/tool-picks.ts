export const TOOL_PICK = /^mcp__[A-Za-z0-9_-]+?__(?:\*|[A-Za-z0-9_-]+)$/;

export const TOOL_PICKS_MAX = 20;

const PREFIX = "Use these tools for this request: ";

const SUFFIX = ". Load any that are not loaded yet before you start.";

const LINE =
  /^Use these tools for this request: ([A-Za-z0-9_*,\s-]+)\. Load any that are not loaded yet before you start\.(?:\n\n|$)/;

export function connectionPick(slug: string): string {
  return `mcp__${slug}__*`;
}

export function withToolPicks(text: string, picks: readonly string[]): string {
  if (picks.length === 0) return text;
  const line = `${PREFIX}${picks.join(", ")}${SUFFIX}`;
  return text ? `${line}\n\n${text}` : line;
}

export function splitToolPicks(text: string): { tools: string[]; text: string } {
  const match = LINE.exec(text);
  if (!match) return { tools: [], text };
  const tools = match[1]!.split(",").map((name) => name.trim());
  if (!tools.every((name) => TOOL_PICK.test(name))) return { tools: [], text };
  return { tools, text: text.slice(match[0].length) };
}
