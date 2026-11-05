/**
 * The Code page's workspace operations on the sandbox: a fixed set, each
 * run with `execFile("git", …)` or `fs` (never a shell). Paths are checked
 * before use: directories must be absolute and exist, file paths inside a
 * diff must be relative and stay inside the repo, assets must sit under
 * the uploads root.
 */
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { CodingError } from "./coding";
import type {
  CodingAsset,
  CodingDirectoryListing,
  CodingFileMatch,
  CodingGitDiff,
  CodingGitFile,
  CodingGitFileDiff,
  CodingGitLogResult,
  CodingLimits,
  CodingOp,
} from "./coding-protocol";

export interface CodingOpsContext {
  limits: Pick<CodingLimits, "maxUploadBytes" | "maxAssetBytes">;
  /** Default `~/.tiny-agents/uploads`. */
  uploadsDir?: string;
  /** Default the worker user's home. */
  home?: string;
}

const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_LIST_ENTRIES = 1_000;

export function defaultUploadsDir(home = homedir()): string {
  return path.join(home, ".tiny-agents", "uploads");
}

export async function runCodingOp(op: CodingOp, ctx: CodingOpsContext): Promise<unknown> {
  switch (op.op) {
    case "git_log":
      return gitLog(await directory(op.cwd), op.limit ?? 30);
    case "git_files":
      return gitFiles(await repoRoot(await directory(op.cwd)), op.diffId);
    case "git_file":
      return gitFile(await repoRoot(await directory(op.cwd)), op.diffId, op.path);
    case "find_files":
      return findFiles(await directory(op.dir), op.query, op.content, op.limit ?? 50);
    case "list_dir":
      return listDir(op.path ?? ctx.home ?? homedir());
    case "validate_cwd":
      return validateCwd(op.path);
    case "upload":
      return upload(op.filename, op.data, ctx);
    case "read_asset":
      return readAsset(op.ref, ctx);
  }
}

// --- paths -------------------------------------------------------------------

function checkAbsolute(value: string): string {
  if (value.includes("\0") || !path.isAbsolute(value)) {
    throw new CodingError("bad_path", "The path must be absolute.");
  }
  return path.resolve(value);
}

async function directory(value: string): Promise<string> {
  const dir = checkAbsolute(value);
  const info = await stat(dir).catch(() => undefined);
  if (!info?.isDirectory()) throw new CodingError("bad_path", `Not a directory: ${dir}`);
  return dir;
}

/** A path inside a repo: relative, normalized, never above the root. */
export function repoRelative(value: string): string {
  if (value.includes("\0") || path.isAbsolute(value) || value.startsWith("-")) {
    throw new CodingError("bad_path", "The file path must be relative to the repository.");
  }
  const normal = path.posix.normalize(value.replaceAll("\\", "/"));
  if (normal === ".." || normal.startsWith("../") || normal === "." || normal === "") {
    throw new CodingError("bad_path", "The file path must stay inside the repository.");
  }
  return normal;
}

// --- git ---------------------------------------------------------------------

function git(cwd: string, args: string[], maxBuffer = 32 * 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["-C", cwd, ...args],
      {
        encoding: "utf8",
        maxBuffer,
        timeout: 20_000,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C" },
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = String(stderr || error.message)
            .trim()
            .split("\n")[0];
          reject(new CodingError("git", detail || "git failed"));
          return;
        }
        resolve(stdout);
      },
    );
  });
}

async function repoRoot(dir: string): Promise<string> {
  try {
    return (await git(dir, ["rev-parse", "--show-toplevel"])).trim();
  } catch {
    throw new CodingError("not_a_repo", `Not a git repository: ${dir}`);
  }
}

async function hasHead(root: string): Promise<boolean> {
  return git(root, ["rev-parse", "--verify", "-q", "HEAD"]).then(
    () => true,
    () => false,
  );
}

interface NumstatRow {
  path: string;
  additions: number;
  deletions: number;
}

/** `--numstat -z` rows (renames are off, so one path per row). */
function parseNumstat(output: string): NumstatRow[] {
  const rows: NumstatRow[] = [];
  for (const record of output.split("\0")) {
    const match = /^(-|\d+)\t(-|\d+)\t(.+)$/s.exec(record.replace(/^\n+/, ""));
    if (!match) continue;
    rows.push({
      path: match[3]!,
      additions: match[1] === "-" ? 0 : Number(match[1]),
      deletions: match[2] === "-" ? 0 : Number(match[2]),
    });
  }
  return rows;
}

/** `--name-status -z`: status, path, status, path … */
function parseNameStatus(output: string): Map<string, string> {
  const parts = output.split("\0").filter((part) => part.length > 0);
  const map = new Map<string, string>();
  for (let i = 0; i + 1 < parts.length; i += 2) {
    map.set(parts[i + 1]!, parts[i]!.trim().charAt(0));
  }
  return map;
}

async function untrackedFiles(root: string): Promise<string[]> {
  const output = await git(root, ["ls-files", "--others", "--exclude-standard", "-z"]);
  return output.split("\0").filter(Boolean);
}

async function lineCount(file: string): Promise<number> {
  const info = await stat(file).catch(() => undefined);
  if (!info?.isFile() || info.size > MAX_FILE_BYTES) return 0;
  const content = await readFile(file, "utf8").catch(() => "");
  if (!content) return 0;
  return content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
}

async function workingFiles(root: string): Promise<CodingGitFile[]> {
  const base = (await hasHead(root)) ? "HEAD" : EMPTY_TREE;
  const [numstat, names, untracked] = await Promise.all([
    git(root, ["diff", base, "--no-renames", "--numstat", "-z"]),
    git(root, ["diff", base, "--no-renames", "--name-status", "-z"]),
    untrackedFiles(root),
  ]);
  const status = parseNameStatus(names);
  const files: CodingGitFile[] = parseNumstat(numstat).map((row) => ({
    path: row.path,
    status: statusOf(status.get(row.path)),
    additions: row.additions,
    deletions: row.deletions,
    isGenerated: isGenerated(row.path),
  }));
  const counts = await Promise.all(
    untracked.slice(0, 500).map((file) => lineCount(path.join(root, file))),
  );
  untracked.slice(0, 500).forEach((file, index) => {
    files.push({
      path: file,
      status: "added",
      additions: counts[index] ?? 0,
      deletions: 0,
      isGenerated: isGenerated(file),
    });
  });
  return files;
}

async function commitFiles(root: string, sha: string): Promise<CodingGitFile[]> {
  const [numstat, names] = await Promise.all([
    git(root, ["show", "--format=", "--no-renames", "--numstat", "-z", sha]),
    git(root, ["show", "--format=", "--no-renames", "--name-status", "-z", sha]),
  ]);
  const status = parseNameStatus(names);
  return parseNumstat(numstat).map((row) => ({
    path: row.path,
    status: statusOf(status.get(row.path)),
    additions: row.additions,
    deletions: row.deletions,
    isGenerated: isGenerated(row.path),
  }));
}

function statusOf(letter: string | undefined): CodingGitFile["status"] {
  if (letter === "A") return "added";
  if (letter === "D") return "deleted";
  return "modified";
}

const GENERATED = [
  /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?|Cargo\.lock|go\.sum|poetry\.lock|uv\.lock|Gemfile\.lock|composer\.lock)$/,
  /(^|\/)(dist|build|out|vendor|node_modules|\.next|coverage)\//,
  /\.min\.(js|css)$/,
  /\.map$/,
  /(^|\/)__snapshots__\//,
  /\.(generated|gen)\.[a-z]+$/,
];

export function isGenerated(file: string): boolean {
  return GENERATED.some((pattern) => pattern.test(file));
}

async function gitLog(dir: string, limit: number): Promise<CodingGitLogResult> {
  const root = await repoRoot(dir);
  const working = await workingFiles(root);
  const diffs: CodingGitDiff[] = [
    {
      id: "working",
      message: "Uncommitted changes",
      author: "",
      timestamp: new Date().toISOString(),
      filesCount: working.length,
      additions: working.reduce((sum, file) => sum + file.additions, 0),
      deletions: working.reduce((sum, file) => sum + file.deletions, 0),
    },
  ];
  if (!(await hasHead(root))) return { gitRoot: root, diffs };
  const output = await git(root, [
    "log",
    `-n${limit}`,
    "--no-renames",
    "--format=%x1e%H%x1f%s%x1f%an%x1f%aI%x1f%D",
    "--numstat",
  ]);
  for (const chunk of output.split("\x1e")) {
    if (!chunk.trim()) continue;
    const [header = "", ...rest] = chunk.split("\n");
    const [sha, subject, author, date, refs] = header.split("\x1f");
    if (!sha) continue;
    let additions = 0;
    let deletions = 0;
    let filesCount = 0;
    for (const line of rest) {
      const match = /^(-|\d+)\t(-|\d+)\t/.exec(line);
      if (!match) continue;
      filesCount += 1;
      additions += match[1] === "-" ? 0 : Number(match[1]);
      deletions += match[2] === "-" ? 0 : Number(match[2]);
    }
    const refList = (refs ?? "")
      .split(",")
      .map((ref) => ref.trim())
      .filter(Boolean);
    diffs.push({
      id: sha,
      message: subject ?? "",
      author: author ?? "",
      timestamp: date ?? "",
      filesCount,
      additions,
      deletions,
      ...(refList.length > 0 ? { refs: refList } : {}),
    });
  }
  return { gitRoot: root, diffs };
}

async function gitFiles(root: string, diffId: string): Promise<CodingGitFile[]> {
  return diffId === "working" ? workingFiles(root) : commitFiles(root, diffId);
}

async function blob(root: string, spec: string): Promise<string> {
  return git(root, ["show", spec], MAX_FILE_BYTES * 2).catch(() => "");
}

async function gitFile(root: string, diffId: string, file: string): Promise<CodingGitFileDiff> {
  const rel = repoRelative(file);
  if (diffId === "working") {
    const head = await hasHead(root);
    const absolute = path.join(root, rel);
    const info = await stat(absolute).catch(() => undefined);
    const newContent =
      info?.isFile() && info.size <= MAX_FILE_BYTES
        ? await readFile(absolute, "utf8").catch(() => "")
        : "";
    return {
      path: rel,
      oldContent: head ? await blob(root, `HEAD:${rel}`) : "",
      newContent,
    };
  }
  const parent = await git(root, ["rev-parse", "--verify", "-q", `${diffId}^`]).then(
    (out) => out.trim(),
    () => "",
  );
  return {
    path: rel,
    oldContent: parent ? await blob(root, `${parent}:${rel}`) : "",
    newContent: await blob(root, `${diffId}:${rel}`),
  };
}

// --- files -------------------------------------------------------------------

async function findFiles(
  dir: string,
  query: string,
  content: "only" | undefined,
  limit: number,
): Promise<CodingFileMatch[]> {
  await repoRoot(dir);
  const needle = query.trim();
  if (content === "only") {
    if (!needle) return [];
    const output = await git(dir, [
      "grep",
      "-n",
      "-I",
      "-F",
      "-i",
      "--untracked",
      "--full-name",
      "-e",
      needle,
      "--",
      ".",
      // `git grep` exits 1 when nothing matches.
    ]).catch(() => "");
    const matches: CodingFileMatch[] = [];
    for (const line of output.split("\n")) {
      const match = /^(.+?):(\d+):(.*)$/.exec(line);
      if (!match) continue;
      matches.push({ path: match[1]!, line: Number(match[2]), text: match[3]!.slice(0, 300) });
      if (matches.length >= limit) break;
    }
    return matches;
  }
  const output = await git(dir, [
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "-z",
    "--",
    ".",
  ]);
  const files = [...new Set(output.split("\0").filter(Boolean))];
  if (!needle) return files.slice(0, limit).map((file) => ({ path: file }));
  const lower = needle.toLowerCase();
  const scored: Array<{ file: string; score: number }> = [];
  for (const file of files) {
    const score = matchScore(file.toLowerCase(), lower);
    if (score > 0) scored.push({ file, score });
  }
  scored.sort((a, b) => b.score - a.score || a.file.length - b.file.length);
  return scored.slice(0, limit).map((entry) => ({ path: entry.file }));
}

/** Basename hits beat path hits beat in-order letters. 0 = no match. */
function matchScore(file: string, query: string): number {
  const base = file.slice(file.lastIndexOf("/") + 1);
  if (base === query) return 100;
  if (base.startsWith(query)) return 80;
  if (base.includes(query)) return 60;
  if (file.includes(query)) return 40;
  let at = 0;
  for (const char of file) {
    if (char === query[at]) at += 1;
    if (at === query.length) return 10;
  }
  return 0;
}

async function listDir(value: string): Promise<CodingDirectoryListing> {
  const dir = await directory(value);
  const entries = await readdir(dir, { withFileTypes: true });
  const list = entries
    .filter((entry) => !entry.name.startsWith("."))
    .map((entry) => ({ name: entry.name, isDir: entry.isDirectory() }))
    .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name))
    .slice(0, MAX_LIST_ENTRIES);
  const parent = path.dirname(dir);
  const root = await git(dir, ["rev-parse", "--show-toplevel"]).then(
    (out) => out.trim(),
    () => undefined,
  );
  const subject = root
    ? await git(dir, ["log", "-1", "--format=%s"]).then(
        (out) => out.trim() || undefined,
        () => undefined,
      )
    : undefined;
  return {
    path: dir,
    ...(parent !== dir ? { parent } : {}),
    entries: list,
    ...(root ? { repoRoot: root } : {}),
    ...(subject ? { headSubject: subject } : {}),
  };
}

async function validateCwd(value: string): Promise<{ valid: boolean; error?: string }> {
  if (!value.trim()) return { valid: false, error: "Choose a working directory." };
  if (value.includes("\0") || !path.isAbsolute(value)) {
    return { valid: false, error: "The working directory must be an absolute path." };
  }
  const info = await stat(value).catch(() => undefined);
  if (!info) return { valid: false, error: `${value} does not exist on the sandbox.` };
  if (!info.isDirectory()) return { valid: false, error: `${value} is not a directory.` };
  return { valid: true };
}

// --- uploads -----------------------------------------------------------------

export function safeFilename(name: string): string {
  const base = path.basename(name.replaceAll("\\", "/"));
  const clean = base
    .replace(/[^\w.\- ]+/g, "_")
    .replace(/^\.+/, "_")
    .slice(0, 200);
  return clean || "file";
}

async function upload(
  filename: string,
  data: string,
  ctx: CodingOpsContext,
): Promise<{ ref: string; name: string }> {
  const bytes = Buffer.from(data, "base64");
  if (bytes.length > ctx.limits.maxUploadBytes) {
    throw new CodingError(
      "too_large",
      `Files over ${Math.round(ctx.limits.maxUploadBytes / 1024 / 1024)} MB cannot be attached.`,
    );
  }
  const root = ctx.uploadsDir ?? defaultUploadsDir(ctx.home);
  const dir = path.join(root, randomBytes(9).toString("base64url"));
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const name = safeFilename(filename);
  const file = path.join(dir, name);
  await writeFile(file, bytes, { mode: 0o600 });
  return { ref: file, name };
}

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".json": "application/json",
  ".csv": "text/csv; charset=utf-8",
};

export function mimeTypeOf(file: string): string {
  return MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}

async function readAsset(ref: string, ctx: CodingOpsContext): Promise<CodingAsset> {
  const root = ctx.uploadsDir ?? defaultUploadsDir(ctx.home);
  const wanted = checkAbsolute(ref);
  const [realRoot, realFile] = await Promise.all([
    realpath(root).catch(() => undefined),
    realpath(wanted).catch(() => undefined),
  ]);
  if (!realRoot || !realFile || !realFile.startsWith(realRoot + path.sep)) {
    throw new CodingError("not_found", "No such asset.");
  }
  const info = await stat(realFile);
  if (!info.isFile()) throw new CodingError("not_found", "No such asset.");
  if (info.size > ctx.limits.maxAssetBytes) {
    throw new CodingError("too_large", "The file is too large to show.");
  }
  const data = await readFile(realFile);
  return {
    name: path.basename(realFile),
    mimeType: mimeTypeOf(realFile),
    data: data.toString("base64"),
  };
}
