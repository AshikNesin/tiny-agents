export const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

const MAX_DIFF_SIDE_BYTES = 2 * 1024 * 1024;

const MAX_UNTRACKED = 500;

const MAX_STAMPED = 2_000;

const BINARY_SNIFF = 8000;

export interface GitRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface GitReadPort {
  git(args: string[]): Promise<GitRunResult>;
  fileSize(relPath: string): Promise<number | null>;
  readFile(relPath: string): Promise<string | null>;
  stats(relPaths: string[]): Promise<string>;
}

export interface ChangedFile {
  path: string;
  status: "added" | "modified" | "deleted";
  additions: number;
  deletions: number;
  binary?: boolean;
}

type Unshowable = "binary" | "tooLarge";

export interface FileSides {
  oldContent: string;
  newContent: string;
  unshowable?: Unshowable;
}

export type Side = { rev: string } | { worktree: true } | null;

export class GitReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitReadError";
  }
}

const READ_FLAGS = ["--no-optional-locks", "-c", "core.quotePath=false"];

async function read(port: GitReadPort, args: string[], what: string): Promise<string> {
  const result = await port.git([...READ_FLAGS, ...args]);
  if (result.exitCode !== 0) {
    const detail = (result.stderr.trim() || result.stdout.trim()).split("\n")[0] ?? "";
    throw new GitReadError(`${what}: ${detail || `git exited ${result.exitCode}`}`);
  }
  return result.stdout;
}

function parseNumstat(output: string): Map<string, { add: number; del: number; binary: boolean }> {
  const rows = new Map<string, { add: number; del: number; binary: boolean }>();
  for (const record of output.split("\0")) {
    const match = /^(-|\d+)\t(-|\d+)\t(.+)$/s.exec(record.replace(/^\n+/, ""));
    if (!match) continue;
    const binary = match[1] === "-" && match[2] === "-";
    rows.set(match[3]!, {
      add: binary ? 0 : Number(match[1]),
      del: binary ? 0 : Number(match[2]),
      binary,
    });
  }
  return rows;
}

function parseNameStatus(output: string): Array<{ code: string; path: string }> {
  const parts = output.split("\0").filter((part) => part.length > 0);
  const rows: Array<{ code: string; path: string }> = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    rows.push({ code: parts[i]!.trim().charAt(0), path: parts[i + 1]! });
  }
  return rows;
}

const statusOf = (code: string): ChangedFile["status"] =>
  code === "A" ? "added" : code === "D" ? "deleted" : "modified";

export async function headCommit(port: GitReadPort): Promise<string | null> {
  const result = await port.git([...READ_FLAGS, "rev-parse", "--verify", "-q", "HEAD^{commit}"]);
  return result.exitCode === 0 ? result.stdout.trim() : null;
}

async function untrackedFiles(port: GitReadPort): Promise<string[]> {
  const out = await read(
    port,
    ["ls-files", "--others", "--exclude-standard", "-z"],
    "Could not list new files",
  );
  return out.split("\0").filter(Boolean);
}

async function lineCounts(port: GitReadPort, paths: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (paths.length === 0) return counts;
  const result = await port.git([
    "--literal-pathspecs",
    ...READ_FLAGS,
    "grep",
    "--untracked",
    "--no-color",
    "-I",
    "-c",
    "-z",
    "",
    "--",
    ...paths,
  ]);
  if (result.exitCode > 1) return counts;
  for (const line of result.stdout.split("\n")) {
    const at = line.indexOf("\0");
    if (at > 0) counts.set(line.slice(0, at), Number(line.slice(at + 1)) || 0);
  }
  return counts;
}

export async function changedFiles(
  port: GitReadPort,
  from: string,
  to?: string,
): Promise<ChangedFile[]> {
  const command = to ? ["diff-tree", "-r"] : ["diff-index"];
  const revs = to ? [from, to] : [from];
  const diff = (format: string) => [...command, "--no-renames", "-z", format, ...revs, "--"];
  const [numstat, names, untracked] = await Promise.all([
    read(port, diff("--numstat"), "Could not diff"),
    read(port, diff("--name-status"), "Could not diff"),
    to ? Promise.resolve([]) : untrackedFiles(port),
  ]);
  const codes = new Map(parseNameStatus(names).map((row) => [row.path, row.code]));
  const files: ChangedFile[] = [...parseNumstat(numstat)].map(([path, count]) => ({
    path,
    status: statusOf(codes.get(path) ?? "M"),
    additions: count.add,
    deletions: count.del,
    ...(count.binary ? { binary: true } : {}),
  }));
  const listed = new Set(files.map((f) => f.path));
  const fresh = untracked.filter((path) => !listed.has(path)).slice(0, MAX_UNTRACKED);
  const lines = await lineCounts(port, fresh);
  for (const path of fresh) {
    const count = lines.get(path);
    files.push({
      path,
      status: "added",
      additions: count ?? 0,
      ...(count === undefined && (await isBinaryFile(port, path)) ? { binary: true } : {}),
      deletions: 0,
    });
  }
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

async function isBinaryFile(port: GitReadPort, path: string): Promise<boolean> {
  const size = await port.fileSize(path);
  if (!size || size > MAX_DIFF_SIDE_BYTES) return false;
  const content = await port.readFile(path);
  return content !== null && isBinaryText(content);
}

function isBinaryText(content: string): boolean {
  return content.slice(0, BINARY_SNIFF).includes("\0");
}

type SideContent = { content: string } | { unshowable: Unshowable };

async function readSide(port: GitReadPort, side: Side, path: string): Promise<SideContent> {
  if (side === null) return { content: "" };
  if ("worktree" in side) {
    const size = await port.fileSize(path);
    if (size === null) return { content: "" };
    if (size > MAX_DIFF_SIDE_BYTES) return { unshowable: "tooLarge" };
    const content = await port.readFile(path);
    if (content === null) return { content: "" };
    return isBinaryText(content) ? { unshowable: "binary" } : { content };
  }
  const spec = `${side.rev}:${path}`;
  const size = await port.git([...READ_FLAGS, "cat-file", "-s", spec]);
  if (size.exitCode !== 0) return { content: "" };
  if (Number(size.stdout.trim()) > MAX_DIFF_SIDE_BYTES) return { unshowable: "tooLarge" };
  const content = await read(port, ["cat-file", "blob", spec], "Could not read the file");
  return isBinaryText(content) ? { unshowable: "binary" } : { content };
}

export async function fileSides(
  port: GitReadPort,
  path: string,
  before: Side,
  after: Side,
): Promise<FileSides> {
  const [old, next] = await Promise.all([
    readSide(port, before, path),
    readSide(port, after, path),
  ]);
  if ("unshowable" in old || "unshowable" in next) {
    const reason =
      ("unshowable" in old && old.unshowable === "tooLarge") ||
      ("unshowable" in next && next.unshowable === "tooLarge")
        ? "tooLarge"
        : "binary";
    return { oldContent: "", newContent: "", unshowable: reason };
  }
  return { oldContent: old.content, newContent: next.content };
}

export async function changeStamp(port: GitReadPort): Promise<string> {
  const head = (await headCommit(port)) ?? "none";
  const status = await read(
    port,
    ["status", "--porcelain=v2", "-z", "--untracked-files=all", "--no-renames"],
    "Could not read the status",
  );
  const paths: string[] = [];
  for (const record of status.split("\0")) {
    if (!record) continue;
    const kind = record[0];
    if (kind === "?") paths.push(record.slice(2));
    else if (kind === "1") paths.push(record.split(" ").slice(8).join(" "));
    else if (kind === "u") paths.push(record.split(" ").slice(10).join(" "));
  }
  const stats = paths.length ? await port.stats(paths.slice(0, MAX_STAMPED)) : "";
  return [head, status, stats].join("\n");
}

const GENERATED = [
  /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?|Cargo\.lock|go\.sum|poetry\.lock|uv\.lock|Gemfile\.lock|composer\.lock)$/,
  /(^|\/)(dist|build|out|vendor|node_modules|\.next|coverage)\//,
  /\.min\.(js|css)$/,
  /\.map$/,
  /\.snap$/,
  /(^|\/)__snapshots__\//,
  /\.(generated|gen)\.[a-z]+$/,
];

export function isGenerated(file: string): boolean {
  return GENERATED.some((pattern) => pattern.test(file));
}

function utf8Bytes(text: string): number {
  if (text.length * 3 <= MAX_DIFF_SIDE_BYTES) return 0;
  if (text.length > MAX_DIFF_SIDE_BYTES) return text.length;
  return new TextEncoder().encode(text).length;
}

export function guardSides<T extends FileSides>(diff: T): T {
  if (diff.unshowable) return diff;
  const sides = [diff.oldContent, diff.newContent];
  const unshowable: Unshowable | undefined = sides.some(
    (side) => utf8Bytes(side) > MAX_DIFF_SIDE_BYTES,
  )
    ? "tooLarge"
    : sides.some(isBinaryText)
      ? "binary"
      : undefined;
  return unshowable ? { ...diff, oldContent: "", newContent: "", unshowable } : diff;
}

export interface Hunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  added: string[];
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function parseHunks(diff: string): Hunk[] {
  const hunks: Hunk[] = [];
  let current: Hunk | undefined;
  for (const line of diff.split("\n")) {
    const header = HUNK_HEADER.exec(line);
    if (header) {
      current = {
        oldStart: Number(header[1]),
        oldCount: header[2] === undefined ? 1 : Number(header[2]),
        newStart: Number(header[3]),
        newCount: header[4] === undefined ? 1 : Number(header[4]),
        added: [],
      };
      hunks.push(current);
    } else if (current && line.startsWith("+")) {
      current.added.push(line.slice(1));
    }
  }
  return hunks;
}

export async function fileHunks(
  port: GitReadPort,
  path: string,
  from: string,
  to: string | null,
  context = 0,
): Promise<Hunk[]> {
  const out = await read(
    port,
    [
      "diff",
      "--no-ext-diff",
      "--no-color",
      "--no-renames",
      `-U${context}`,
      from,
      ...(to ? [to] : []),
      "--",
      path,
    ],
    `Could not diff ${path}`,
  );
  return parseHunks(out);
}
