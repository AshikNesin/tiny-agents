/**
 * Transcript presentation shared by every harness: runs of finished tool
 * calls fold into one "Ran 3 commands, edited 2 files" line, so a long turn
 * reads as its messages. Rows are the harness contract's `TranscriptItem`s.
 */
import type { ToolItem, ToolKind, TranscriptItem } from "./api";

/** A run of finished tool calls shown as one line. */
export interface ToolGroup {
  kind: "tool-group";
  id: string;
  tools: ToolItem[];
  /** The tools with the thinking between them, in order. */
  items: Array<ToolItem | Extract<TranscriptItem, { kind: "thinking" }>>;
}

/** A finished turn's work (thinking, progress notes, tools) folded behind one "Worked for" row. */
export interface WorkFold {
  kind: "work";
  id: string;
  items: Array<TranscriptItem | ToolGroup>;
  durationMs?: number;
  costUsd?: number;
}

export type DisplayItem = TranscriptItem | ToolGroup | WorkFold;

/** Tools that stand on their own: cards, messages, and steps whose screenshots matter. */
function standsAlone(item: ToolItem): boolean {
  return (
    item.status === "running" ||
    item.tool === "subagent" ||
    item.tool === "message_user" ||
    item.tool === "message_parent" ||
    item.tool === "todo" ||
    item.images.length > 0
  );
}

/**
 * Folds runs of two or more finished tool calls (and the thinking between
 * them) into one collapsible group; running tools, subagents, plans and
 * screenshots stay in view.
 */
export function groupTools(items: TranscriptItem[]): Array<TranscriptItem | ToolGroup> {
  const out: Array<TranscriptItem | ToolGroup> = [];
  let run: ToolGroup["items"] = [];
  const flush = () => {
    // Thinking after the last tool belongs to what follows, not the group.
    let end = run.length;
    while (end > 0 && run[end - 1]!.kind === "thinking") end--;
    const body = run.slice(0, end);
    const tools = body.filter((i): i is ToolItem => i.kind === "tool");
    if (tools.length >= 2) {
      out.push({ kind: "tool-group", id: `group:${tools[0]!.id}`, tools, items: body });
    } else {
      out.push(...body);
    }
    out.push(...run.slice(end));
    run = [];
  };
  for (const item of items) {
    if (item.kind === "tool" && !standsAlone(item)) {
      run.push(item);
    } else if (item.kind === "thinking" && run.length > 0) {
      run.push(item);
    } else {
      flush();
      out.push(item);
    }
  }
  flush();
  return out;
}

/** Rows that are the agent working rather than answering. */
const isWork = (item: TranscriptItem) =>
  item.kind === "tool" ||
  item.kind === "thinking" ||
  item.kind === "job" ||
  item.kind === "report" ||
  item.kind === "request";

/**
 * Folds each finished turn into its first message, one "Worked for 3m 34s"
 * row, and the answer (the text after its last piece of work), the way Amp
 * and Hoplite read. A turn still running stays fully in view.
 */
export function foldTurns(items: TranscriptItem[]): DisplayItem[] {
  const out: DisplayItem[] = [];
  let start = 0;
  const finishTurn = (end: number, turn?: Extract<TranscriptItem, { kind: "turn" }>) => {
    const segment = items.slice(start, end);
    const first = segment.findIndex((i) => i.kind === "user");
    let lastWork = -1;
    segment.forEach((item, i) => {
      if (i > first && (isWork(item) || item.kind === "user")) lastWork = i;
    });
    const folded = segment.slice(first + 1, lastWork + 1);
    if (!turn || lastWork < 0 || !folded.some(isWork)) {
      out.push(...groupTools(segment));
      if (turn) out.push(turn);
      return;
    }
    out.push(...groupTools(segment.slice(0, first + 1)));
    out.push({
      kind: "work",
      id: `work:${folded[0]!.id}`,
      items: groupTools(folded),
      durationMs: turn.durationMs,
      costUsd: turn.costUsd,
    });
    out.push(...groupTools(segment.slice(lastWork + 1)));
  };
  items.forEach((item, i) => {
    if (item.kind !== "turn") return;
    finishTurn(i, item);
    start = i + 1;
  });
  finishTurn(items.length);
  return out;
}

/** "Ran 3 commands, edited 2 files" for a group's summary line. */
export function describeTools(tools: ToolItem[]): string {
  const count = (kind: ToolKind) => tools.filter((t) => t.tool === kind).length;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const parts: string[] = [];
  const bash = count("bash");
  const edit = count("edit");
  const read = count("read");
  const search = count("search");
  const browser = count("browser");
  const other = tools.length - bash - edit - read - search - browser;
  if (bash) parts.push(`ran ${plural(bash, "command", "commands")}`);
  if (edit) parts.push(`edited ${plural(edit, "file", "files")}`);
  if (read) parts.push(`read ${plural(read, "file", "files")}`);
  if (search) parts.push(`searched ${plural(search, "time", "times")}`);
  if (browser) parts.push(`used the browser ${plural(browser, "time", "times")}`);
  if (other) parts.push(`used ${plural(other, "tool", "tools")}`);
  const text = parts.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The id of the last error notice when nothing followed it (it offers recovery). */
export function lastErrorId(items: TranscriptItem[]): string | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!;
    if (item.kind === "notice" && item.level === "error") return item.id;
    if (item.kind === "assistant" || item.kind === "tool" || item.kind === "user") return null;
  }
  return null;
}
