const WRAPPERS = new Set(["generic", "rowgroup", "none", "presentation", "group", "cell"]);
const REF_ROLES = new Set([
  "button",
  "link",
  "textbox",
  "searchbox",
  "combobox",
  "listbox",
  "option",
  "checkbox",
  "radio",
  "switch",
  "slider",
  "spinbutton",
  "tab",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "treeitem",
  "gridcell",
  "columnheader",
  "scrollbar",
  "iframe",
  "main",
  "navigation",
  "banner",
  "contentinfo",
  "complementary",
  "region",
  "search",
  "form",
  "dialog",
  "alertdialog",
  "article",
  "table",
  "list",
  "menu",
  "tree",
  "grid",
  "tablist",
]);
const EMPTY_WHEN_BARE = new Set([...WRAPPERS, "row", "cell", "listitem", "paragraph"]);
const MAX_URL_CHARS = 200;

const NODE = /^(\s*)- ([a-z]+)(.*)$/;
const UNNAMED_REST = /^((?: \[[^\]]*\])*)(:.*)?$/;

export function compactSnapshot(snapshot: string): string {
  const out: string[] = [];
  const unwrapped: number[] = [];
  for (const raw of snapshot.split("\n")) {
    const clickable = raw.includes(" [cursor=pointer]");
    let line = raw.replaceAll(" [cursor=pointer]", "").replace(" [active]", "");
    const indent = indentOf(line);
    while (unwrapped.length > 0 && indent <= unwrapped[unwrapped.length - 1]) unwrapped.pop();
    const node = NODE.exec(line);
    if (node) {
      const [, , role, rest] = node;
      const unnamed = UNNAMED_REST.exec(rest);
      if (unnamed) {
        const tail = unnamed[2];
        if (tail === ":" && WRAPPERS.has(role)) {
          unwrapped.push(indent);
          continue;
        }
        if (tail === undefined && EMPTY_WHEN_BARE.has(role)) continue;
      }
      if (!clickable && !REF_ROLES.has(role)) line = line.replace(/ \[ref=[^\]]+\]/, "");
    }
    const shift = unwrapped.length * 2;
    let kept = shift > 0 ? line.slice(Math.min(shift, indent)) : line;
    const url = /^(\s*)- \/url: (.*)$/.exec(kept);
    if (url) {
      const href = url[2].length > MAX_URL_CHARS ? `${url[2].slice(0, MAX_URL_CHARS)}…` : url[2];
      const owner = out.length - 1;
      const prev = out[owner];
      if (prev?.endsWith(":") && indentOf(prev) === url[1].length - 2) {
        out[owner] = `${prev.slice(0, -1)} [url=${href}]:`;
        continue;
      }
      kept = `${url[1]}- /url: ${href}`;
    }
    out.push(kept);
  }
  return out
    .map((line, i) =>
      line.endsWith("]:") && !(indentOf(out[i + 1] ?? "") > indentOf(line))
        ? line.slice(0, -1)
        : line,
    )
    .join("\n");
}

const indentOf = (line: string): number => line.length - line.trimStart().length;

export function filterSnapshot(snapshot: string, query: string): { text: string; matches: number } {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const lines = snapshot
    .split("\n")
    .filter((line) => words.every((word) => line.toLowerCase().includes(word)))
    .map((line) => line.trim());
  return { text: lines.join("\n"), matches: lines.length };
}

export function pageWindow(
  text: string,
  offset: number,
  limit: number,
  hint: string,
  via = "again",
): { text: string; nextOffset: number | null } {
  const start = Math.min(Math.max(0, offset), text.length);
  if (start === 0 && text.length <= limit) return { text, nextOffset: null };
  let end = Math.min(text.length, start + limit);
  if (end < text.length) {
    const lineBreak = text.lastIndexOf("\n", end);
    if (lineBreak > start + limit / 2) end = lineBreak;
  }
  const head = start > 0 ? `…(from character ${start} of ${text.length})\n` : "";
  const body = text.slice(start, end);
  if (end >= text.length) return { text: head + body, nextOffset: null };
  const next = text[end] === "\n" ? end + 1 : end;
  const rest = text.length - next;
  return {
    text: `${head}${body}\n…(${rest} more characters. Call ${via} with offset ${next} to read on${hint})`,
    nextOffset: next,
  };
}

export function tidyText(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function snapshotDiff(
  before: string,
  after: string,
): { added: number; removed: number; text: string } {
  const remaining = new Map<string, number>();
  for (const line of before.split("\n")) remaining.set(line, (remaining.get(line) ?? 0) + 1);
  const lines = after.split("\n");
  const isNew = lines.map((line) => {
    const left = remaining.get(line) ?? 0;
    if (left === 0) return true;
    remaining.set(line, left - 1);
    return false;
  });
  let removed = 0;
  for (const left of remaining.values()) removed += left;
  const out: string[] = [];
  let lastContext = -1;
  lines.forEach((line, i) => {
    if (!isNew[i]) return;
    const indent = indentOf(line);
    for (let j = i - 1; j >= 0; j--) {
      if (indentOf(lines[j]) < indent) {
        if (!isNew[j] && j !== lastContext) {
          out.push(`  ${lines[j]}`);
          lastContext = j;
        }
        break;
      }
    }
    out.push(`+ ${line}`);
  });
  return { added: isNew.filter(Boolean).length, removed, text: out.join("\n") };
}
