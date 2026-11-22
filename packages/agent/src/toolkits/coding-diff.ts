interface Line {
  text: string;
  newline: boolean;
}

interface Op {
  kind: " " | "-" | "+";
  line: Line;
}

const LCS_CELLS = 4_000_000;

function linesOf(content: string): Line[] {
  if (content === "") return [];
  const ended = content.endsWith("\n");
  const parts = (ended ? content.slice(0, -1) : content).split("\n");
  return parts.map((text, index) => ({ text, newline: ended || index < parts.length - 1 }));
}

const same = (a: Line, b: Line) => a.text === b.text && a.newline === b.newline;
const kept = (line: Line): Op => ({ kind: " ", line });
const removed = (line: Line): Op => ({ kind: "-", line });
const added = (line: Line): Op => ({ kind: "+", line });

function changedOps(before: readonly Line[], after: readonly Line[]): Op[] {
  const rows = before.length;
  const cols = after.length;
  if (rows === 0 || cols === 0 || rows * cols > LCS_CELLS) {
    return [...before.map(removed), ...after.map(added)];
  }
  const width = cols + 1;
  const common = new Uint32Array((rows + 1) * width);
  for (let row = rows - 1; row >= 0; row--) {
    for (let col = cols - 1; col >= 0; col--) {
      common[row * width + col] = same(before[row]!, after[col]!)
        ? common[(row + 1) * width + col + 1]! + 1
        : Math.max(common[(row + 1) * width + col]!, common[row * width + col + 1]!);
    }
  }
  const ops: Op[] = [];
  let row = 0;
  let col = 0;
  while (row < rows && col < cols) {
    if (same(before[row]!, after[col]!)) {
      ops.push(kept(before[row]!));
      row++;
      col++;
    } else if (common[(row + 1) * width + col]! >= common[row * width + col + 1]!) {
      ops.push(removed(before[row++]!));
    } else {
      ops.push(added(after[col++]!));
    }
  }
  return [...ops, ...before.slice(row).map(removed), ...after.slice(col).map(added)];
}

function opsOf(before: readonly Line[], after: readonly Line[]): Op[] {
  const shorter = Math.min(before.length, after.length);
  let head = 0;
  while (head < shorter && same(before[head]!, after[head]!)) head++;
  let tail = 0;
  while (
    tail < shorter - head &&
    same(before[before.length - 1 - tail]!, after[after.length - 1 - tail]!)
  ) {
    tail++;
  }
  return [
    ...before.slice(0, head).map(kept),
    ...changedOps(before.slice(head, before.length - tail), after.slice(head, after.length - tail)),
    ...before.slice(before.length - tail).map(kept),
  ];
}

function span(start: number, count: number): string {
  if (count === 1) return String(start);
  return `${count === 0 ? start - 1 : start},${count}`;
}

export function unifiedDiff(path: string, before: string, after: string, context = 3): string {
  const ops = opsOf(linesOf(before), linesOf(after));
  const hunks: Array<[number, number]> = [];
  ops.forEach((op, index) => {
    if (op.kind === " ") return;
    const start = Math.max(0, index - context);
    const end = Math.min(ops.length - 1, index + context);
    const last = hunks.at(-1);
    if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end);
    else hunks.push([start, end]);
  });
  if (hunks.length === 0) return "";
  const oldAt: number[] = [];
  const newAt: number[] = [];
  let oldLine = 1;
  let newLine = 1;
  for (const op of ops) {
    oldAt.push(oldLine);
    newAt.push(newLine);
    if (op.kind !== "+") oldLine++;
    if (op.kind !== "-") newLine++;
  }
  const body = hunks.map(([start, end]) => {
    const part = ops.slice(start, end + 1);
    const oldCount = part.filter((op) => op.kind !== "+").length;
    const newCount = part.filter((op) => op.kind !== "-").length;
    const lines = part.flatMap((op) => {
      const line = `${op.kind}${op.line.text}`;
      return op.line.newline ? [line] : [line, "\\ No newline at end of file"];
    });
    return [
      `@@ -${span(oldAt[start]!, oldCount)} +${span(newAt[start]!, newCount)} @@`,
      ...lines,
    ].join("\n");
  });
  const label = (side: "a" | "b") => (path.startsWith("/") ? path : `${side}/${path}`);
  return `--- ${label("a")}\n+++ ${label("b")}\n${body.join("\n")}\n`;
}
