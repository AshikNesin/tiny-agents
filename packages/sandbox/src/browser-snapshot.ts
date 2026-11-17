/**
 * What the model reads of a page: the snapshot made compact, and any page
 * read cut to a budget with a way to read on. Pure text in, text out, so the
 * rules are tested without a browser.
 *
 * Playwright's `ai` snapshot puts a ref on every node and keeps every layout
 * wrapper (`generic`, `rowgroup`), so on real pages it runs 5 to 12 times the
 * size of the page's text: Hacker News is 47k characters for 4k of text.
 * Unwrapping unnamed wrappers, and keeping refs only on what can be acted on
 * or scoped to, keeps every piece of text at about half the size.
 */

/** Wrapper roles that carry no meaning without a name: their children move up a level. */
const WRAPPERS = new Set(["generic", "rowgroup", "none", "presentation", "group", "cell"]);
/**
 * Roles that keep their ref: what can be clicked or typed into, and the
 * regions a snapshot can be scoped to. Any other node keeps its ref only
 * when the page marks it clickable (`[cursor=pointer]`); a ref on a
 * paragraph or a list item is a dozen characters the model never uses.
 */
const REF_ROLES = new Set([
  // controls
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
  // scopes
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
/** Roles that say nothing when they have no name, value or children. */
const EMPTY_WHEN_BARE = new Set([...WRAPPERS, "row", "cell", "listitem", "paragraph"]);
/** A link's `/url` past this is cut: a tracking query string costs more than it tells. */
const MAX_URL_CHARS = 200;

/** One snapshot line: indent, role, and what follows the role. */
const NODE = /^(\s*)- ([a-z]+)(.*)$/;
/** After the role of an unnamed node: only attributes, then nothing, `:` (children) or `: value`. */
const UNNAMED_REST = /^((?: \[[^\]]*\])*)(:.*)?$/;

/**
 * The snapshot with unnamed wrappers unwrapped (their children dedented one
 * level), bare structural leaves dropped, refs kept only on controls,
 * clickable nodes and scopes (`REF_ROLES`), `[cursor=pointer]` removed, and
 * a link's URL moved onto its line (`[url=…]`, cut when long). Text is kept
 * as it was.
 */
export function compactSnapshot(snapshot: string): string {
  const out: string[] = [];
  /** Indents of the unwrapped wrappers enclosing the current line. */
  const unwrapped: number[] = [];
  for (const raw of snapshot.split("\n")) {
    const clickable = raw.includes(" [cursor=pointer]");
    let line = raw.replaceAll(" [cursor=pointer]", "");
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
      // A link's URL goes on the link's own line: one line per link, not two.
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
  // A node whose children all went (or moved onto its line) no longer opens a block.
  return out
    .map((line, i) =>
      line.endsWith("]:") && !(indentOf(out[i + 1] ?? "") > indentOf(line))
        ? line.slice(0, -1)
        : line,
    )
    .join("\n");
}

const indentOf = (line: string): number => line.length - line.trimStart().length;

/**
 * Keep the lines that contain every word of `query` (case-insensitive), so
 * the model can find "checkout" or "price" on a long page without reading
 * all of it. Each match keeps its ref.
 */
export function filterSnapshot(snapshot: string, query: string): { text: string; matches: number } {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const lines = snapshot
    .split("\n")
    .filter((line) => words.every((word) => line.toLowerCase().includes(word)))
    .map((line) => line.trim());
  return { text: lines.join("\n"), matches: lines.length };
}

/**
 * A page read cut to `limit` characters from `offset`, at a line break where
 * one is close, with a note that says how much is left and how to read on.
 * Without it a long page was cut at the top and the rest could not be
 * reached at all: every later snapshot started from the same place.
 */
export function pageWindow(
  text: string,
  offset: number,
  limit: number,
  hint: string,
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
    text: `${head}${body}\n…(${rest} more characters. Call again with offset ${next} to read on${hint})`,
    nextOffset: next,
  };
}

/** Page text with runs of blank lines and trailing spaces squeezed out. */
export function tidyText(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
