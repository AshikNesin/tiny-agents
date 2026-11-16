/**
 * Reading a repository's changes for the Code page's Changes and Review
 * panels, for every harness, in one place: the app runs it over SSH for
 * project worktrees whatever agent works in them (`code.workspace.ts`), the
 * Claude worker runs it next to the files (`coding-ops`), and the app's
 * guard (`guardSides`) holds every harness's diffs to the same rules. One
 * module so they never drift again. It has no dependencies (ADR 0025, R14).
 *
 * Every read is safe to run while an agent works in the same repository:
 *
 * - `--no-optional-locks`: a read never refreshes (rewrites) the index, so it
 *   never holds `index.lock` when the agent commits;
 * - `-z` output and `core.quotePath=false`: paths arrive exactly as they are
 *   (spaces, non-ASCII), never C-quoted;
 * - `--no-renames` on every listing, so the counts and the statuses describe
 *   the same paths (a rename is a deletion and an addition);
 * - `--no-ext-diff --no-color`: the user's diff config never changes the output;
 * - untracked files (not ignored) count as added: an agent's new file shows
 *   before it is committed;
 * - a side that is binary or too large to diff says so (`unshowable`)
 *   instead of sending its bytes or an empty string that reads as a deletion.
 *
 * The port runs git with an argument list (never through a shell's word
 * splitting) and reads working-tree files; paths it is given are relative to
 * the repository root.
 */

/** Git's empty tree: the base of a repository with no commit yet, or of a root commit. */
export const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/** Past this size a side is not sent: the panel says the file is too large to diff. */
const MAX_DIFF_SIDE_BYTES = 2 * 1024 * 1024;

/** Untracked files listed at most (each one's lines are counted). */
const MAX_UNTRACKED = 500;

/** Changed paths whose times a change stamp reads. */
const MAX_STAMPED = 2_000;

/** A NUL in the first 8000 bytes means binary, as git decides. */
const BINARY_SNIFF = 8000;

export interface GitRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface GitReadPort {
  /** Run `git <args>` in the repository root. */
  git(args: string[]): Promise<GitRunResult>;
  /** A working-tree file's size in bytes, or null when it is not a regular file. */
  fileSize(relPath: string): Promise<number | null>;
  /** A working-tree file decoded as UTF-8, or null when it cannot be read. */
  readFile(relPath: string): Promise<string | null>;
  /**
   * Size and modification time (nanoseconds where the filesystem has them)
   * of each working-tree path, one line each, in one call; a missing path
   * still gets a line, so the answer changes when a file appears or goes.
   */
  stats(relPaths: string[]): Promise<string>;
}

export interface ChangedFile {
  path: string;
  status: "added" | "modified" | "deleted";
  additions: number;
  deletions: number;
  /** Git sees binary content: no line counts, and no diff to show. */
  binary?: boolean;
}

/** Why a file's diff is not shown as text. */
type Unshowable = "binary" | "tooLarge";

export interface FileSides {
  oldContent: string;
  newContent: string;
  /** Set when either side is binary or too large: both contents are then empty. */
  unshowable?: Unshowable;
}

/** One side of a diff: a blob (`rev:path`), the working tree, or nothing (the file is absent). */
export type Side = { rev: string } | { worktree: true } | null;

export class GitReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitReadError";
  }
}

/** Flags every read runs with; see the module comment. */
const READ_FLAGS = ["--no-optional-locks", "-c", "core.quotePath=false"];

async function read(port: GitReadPort, args: string[], what: string): Promise<string> {
  const result = await port.git([...READ_FLAGS, ...args]);
  if (result.exitCode !== 0) {
    const detail = (result.stderr.trim() || result.stdout.trim()).split("\n")[0] ?? "";
    throw new GitReadError(`${what}: ${detail || `git exited ${result.exitCode}`}`);
  }
  return result.stdout;
}

/** `--numstat -z` records (renames off: one path each). */
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

/** `--name-status -z`: status, path, status, path … */
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

/** The sha HEAD names, or null in a repository with no commit yet. */
export async function headCommit(port: GitReadPort): Promise<string | null> {
  const result = await port.git([...READ_FLAGS, "rev-parse", "--verify", "-q", "HEAD^{commit}"]);
  return result.exitCode === 0 ? result.stdout.trim() : null;
}

/** Untracked files that are not ignored, as git lists them. */
async function untrackedFiles(port: GitReadPort): Promise<string[]> {
  const out = await read(
    port,
    ["ls-files", "--others", "--exclude-standard", "-z"],
    "Could not list new files",
  );
  return out.split("\0").filter(Boolean);
}

/** Lines in each text file (binary files are left out), in one `git grep`. */
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
  // `git grep` exits 1 when nothing matched (every file empty or binary).
  if (result.exitCode > 1) return counts;
  for (const line of result.stdout.split("\n")) {
    const at = line.indexOf("\0");
    if (at > 0) counts.set(line.slice(0, at), Number(line.slice(at + 1)) || 0);
  }
  return counts;
}

/**
 * Files that differ from `from`: in `to` when given (two commits), else in
 * the working tree, untracked files included. Sorted by path.
 */
export async function changedFiles(
  port: GitReadPort,
  from: string,
  to?: string,
): Promise<ChangedFile[]> {
  // Plumbing, not `git diff`: porcelain diff refreshes the index even under
  // `--no-optional-locks`. Without that refresh a file whose timestamp moved
  // but whose content did not is "M" in `--name-status` yet absent from
  // `--numstat` (which compares content), so numstat decides what changed.
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
      // Not counted by `grep -I`: binary, or empty (an empty file has no lines either way).
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

/** A NUL near the start, as git decides binary. */
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
  // Not in that commit: the file was added (or deleted) on the other side.
  if (size.exitCode !== 0) return { content: "" };
  if (Number(size.stdout.trim()) > MAX_DIFF_SIDE_BYTES) return { unshowable: "tooLarge" };
  const content = await read(port, ["cat-file", "blob", spec], "Could not read the file");
  return isBinaryText(content) ? { unshowable: "binary" } : { content };
}

/**
 * One file's two sides. A side that is absent reads as empty; a binary or
 * oversized side makes the whole file `unshowable` (both contents empty).
 */
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

/**
 * A short fingerprint of the working tree's state as these reads see it:
 * HEAD, the status of every changed path, and each changed file's size and
 * modification time. One git call and one stat call, cheap enough to repeat
 * every second or two while someone looks. A write to an already-changed file
 * moves its time; ignored files never count.
 */
export async function changeStamp(port: GitReadPort): Promise<string> {
  const head = (await headCommit(port)) ?? "none";
  const status = await read(
    port,
    ["status", "--porcelain=v2", "-z", "--untracked-files=all", "--no-renames"],
    "Could not read the status",
  );
  // Each record: `1 XY … path`, `u …`, or `? path`; the path is the last field.
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

/** Lockfiles, build output and snapshots: listed muted and last, folded by default. */
export function isGenerated(file: string): boolean {
  return GENERATED.some((pattern) => pattern.test(file));
}

/** UTF-8 bytes in a string, without encoding it when it is plainly small or plainly large. */
function utf8Bytes(text: string): number {
  if (text.length * 3 <= MAX_DIFF_SIDE_BYTES) return 0;
  if (text.length > MAX_DIFF_SIDE_BYTES) return text.length;
  return new TextEncoder().encode(text).length;
}

/**
 * Any harness's file diff held to the rules this module's own reads follow:
 * a side that is binary or over the size cap makes the file `unshowable`
 * (both sides emptied), so the panel says why instead of drawing bytes or a
 * whole-file change. A diff that already says so passes through.
 */
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
