/**
 * Git on the sandbox for Code projects (issue #297 §6): clone, a worktree
 * per thread, diffs against the base branch, sync to the remote head and the
 * app's push. Every command goes through one exec port (the Sandbox
 * connection in the app, a local shell in tests), so this module never
 * knows how it reaches the machine.
 *
 * The push rules (§7.3) live here:
 *
 * - never forced: a plain push, which git itself rejects if the remote moved;
 * - hooks off (`core.hooksPath=/dev/null`) and an explicit remote URL, so a
 *   `pre-push` hook the agent wrote never runs with the credential;
 * - the credential is handed to the one command: the vault token arrives on
 *   stdin and lives only in that command's environment, never on its command
 *   line or on disk; without a token, `gh auth git-credential` answers.
 */
import { shQuote } from "@tiny-agents/sandbox";
import type { ExecPort, ExecResult, RepoRef } from "@tiny-agents/github";
import type { GitFile, GitFileDiff } from "@tiny-agents/code/contracts";
import {
  changeStamp,
  changedFiles,
  fileHunks,
  fileSides,
  isGenerated,
  type ChangedFile,
  type GitReadPort,
  type Hunk,
} from "@tiny-agents/git";

const q = shQuote;

/** How git authenticates to GitHub for clone, fetch and push. */
type GitCredential = { kind: "gh" } | { kind: "token"; token: () => Promise<string> };

export interface WorkspaceOptions {
  exec: ExecPort;
  credential: GitCredential;
  /** The remote a repository is fetched from and pushed to (tests use a local bare repo). */
  remoteUrl?: (repo: RepoRef) => string;
}

export class WorkspaceError extends Error {
  constructor(
    message: string,
    /** rejected (the remote moved), diverged, missing, failed. */
    readonly code: "rejected" | "diverged" | "missing" | "failed" = "failed",
  ) {
    super(message);
    this.name = "WorkspaceError";
  }
}

export interface ProjectScripts {
  setup?: string;
  check?: string;
  archive?: string;
}

/** The checked-in scripts file (issue #297 §6). */
const SCRIPTS_FILE = ".tiny-agents/code.json";

const GIT_TIMEOUT_MS = 5 * 60_000;
const SCRIPT_TIMEOUT_MS = 15 * 60_000;

const githubUrl = (repo: RepoRef) => `https://github.com/${repo.owner}/${repo.name}.git`;

/** The end of a failed command's output. */
const tail = (result: ExecResult, chars = 2000) =>
  (result.stderr.trim() || result.stdout.trim()).slice(-chars);

export interface Workspace {
  /** Which tools the sandbox has (a project needs both). */
  tools(): Promise<{ git: boolean; gh: boolean }>;
  /** The sandbox user's home, where project checkouts live. */
  home(): Promise<string>;
  exists(path: string): Promise<boolean>;
  clone(repo: RepoRef, path: string): Promise<void>;
  /** Fetch the base branch and cut `branch` from it into a new worktree; answers the base sha. */
  addWorktree(checkout: string, path: string, branch: string, base: string): Promise<string>;
  /** A worktree on a branch that already exists (locally or on the remote): unarchive, a PR's head. */
  addWorktreeForBranch(checkout: string, path: string, branch: string): Promise<void>;
  /**
   * A pull request's head (`refs/pull/N/head`, so a PR from a fork works too)
   * and its base, fetched; then a detached worktree at that head, made or, when
   * it has no uncommitted changes, moved there. Answers the head sha.
   */
  pullWorktree(checkout: string, path: string, number: number, base: string): Promise<string>;
  /** A local branch, or one the last fetch saw on the remote, already has this name. */
  branchTaken(checkout: string, branch: string): Promise<boolean>;
  removeWorktree(checkout: string, path: string): Promise<void>;
  headSha(path: string): Promise<string>;
  /** Uncommitted changes, as `git status --porcelain` lines. */
  uncommitted(path: string): Promise<string[]>;
  /**
   * Files changed since the merge base with `origin/<base>` (working tree and
   * new files included), with content hashes.
   */
  baseFiles(path: string, base: string): Promise<Array<GitFile & { hash: string }>>;
  /** One file's merge-base and working-tree content (or why it cannot be shown). */
  baseFile(path: string, base: string, file: string): Promise<FileContents>;
  /**
   * Files changed since commit `sha` (an earlier head of a PR: the one its
   * reviewer last read), fetched first when the worktree lacks it.
   */
  sinceFiles(path: string, sha: string): Promise<Array<GitFile & { hash: string }>>;
  sinceFile(path: string, sha: string, file: string): Promise<FileContents>;
  /** A fingerprint of the worktree's changes: it moves when the Review panel would change. */
  changeStamp(path: string): Promise<string>;
  /** Commits on HEAD that are not on `origin/<base>`, newest first. */
  commitsAhead(path: string, base: string): Promise<Array<{ sha: string; subject: string }>>;
  /** Paths changed between two commits. */
  changedPaths(path: string, from: string, to: string): Promise<string[]>;
  /**
   * Bring the worktree up to the remote branch: fast-forward when the remote
   * is ahead, nothing when it is behind or absent. Throws `diverged` when both moved.
   */
  syncToRemote(path: string, repo: RepoRef, branch: string): Promise<void>;
  /** Push HEAD to `branch` on the repository, never forced; answers the pushed sha. */
  push(path: string, repo: RepoRef, branch: string): Promise<string>;
  /**
   * Commit every change in the worktree (new files included) with `message`,
   * as the configured git identity or else `as`. The repository's hooks do
   * not run: a review's checkout has none of its tools installed.
   */
  commitAll(path: string, message: string, as: { name: string; email: string }): Promise<void>;
  /** Put the worktree back at commit `sha` exactly: changes, new files and later commits go. */
  discard(path: string, sha: string): Promise<void>;
  /**
   * One file's hunks from commit `from` to `to` (the working tree when null),
   * with `context` lines around each. `from` may be `merge-base:<base>:<sha>`:
   * the merge base of `sha` with `origin/<base>`, as a PR's own diff starts.
   */
  hunks(
    path: string,
    file: string,
    from: string,
    to: string | null,
    context?: number,
  ): Promise<Hunk[]>;
  /** The checked-in scripts, if the file exists and parses. */
  readScripts(path: string): Promise<ProjectScripts>;
  runScript(path: string, script: string): Promise<{ ok: boolean; output: string }>;
  /**
   * Every commit made in the worktree gets `trailer` (`Thread-Id: <id>`):
   * a per-worktree hooks directory whose `commit-msg` adds it, and whose
   * every hook then runs the repository's own hook of that name.
   */
  installTrailer(path: string, hooksDir: string, trailer: string): Promise<void>;
  /**
   * A checkpoint: the worktree as it is now, uncommitted changes and new
   * files included, as a commit on top of HEAD kept under `ref`. Nothing in
   * the worktree, its index or its branch changes. Answers the commit.
   */
  checkpoint(path: string, ref: string): Promise<string>;
  /** Files that differ between two commits (checkpoints), with blob ids. */
  rangeFiles(path: string, from: string, to: string): Promise<Array<GitFile & { hash: string }>>;
  rangeFile(path: string, from: string, to: string, file: string): Promise<FileContents>;
  /**
   * Put the worktree's files back as they were at a checkpoint, as
   * uncommitted changes: HEAD and the branch's history are untouched, so
   * nothing pushed is ever rewritten.
   */
  restore(path: string, sha: string): Promise<void>;
}

/** A file's two sides, or why they are not sent (`unshowable`). */
type FileContents = Omit<GitFileDiff, "path">;

/** Every hook git runs, so a per-worktree hooks directory can hand each to the repository's own. */
const HOOK_NAMES = [
  "applypatch-msg",
  "pre-applypatch",
  "post-applypatch",
  "pre-commit",
  "pre-merge-commit",
  "prepare-commit-msg",
  "commit-msg",
  "post-commit",
  "pre-rebase",
  "post-checkout",
  "post-merge",
  "pre-push",
  "post-rewrite",
  "pre-auto-gc",
  "reference-transaction",
  "fsmonitor-watchman",
];

/** The identity checkpoint commits are made under (the sandbox may have none configured). */
const CHECKPOINT_ID =
  "GIT_AUTHOR_NAME=tiny-agents GIT_AUTHOR_EMAIL=checkpoints@tiny-agents.invalid " +
  "GIT_COMMITTER_NAME=tiny-agents GIT_COMMITTER_EMAIL=checkpoints@tiny-agents.invalid";

/** Where a thread's checkpoint `seq` is kept in the project's clone (hidden from branches and tags). */
export function checkpointRef(branch: string, seq: number): string {
  return `refs/tiny-agents/checkpoints/${branch.replaceAll("/", "_")}/${seq}`;
}

/** Words a task's wording carries that say nothing about the change. */
const FILLER: readonly string[] = (
  "a an the to for of in on at by with and or but so that this these those it its is are be " +
  "can could would will should you your please pls i we us me my our lets let want need like " +
  "help hey hi ok okay just also some there here when then now currently"
).split(" ");

/** Up to `maxWords` words joined by hyphens, stopping at a word before `maxLength`. */
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

/**
 * A branch slug from a task's own words when no model names it: the first
 * few words that are not filler ("Can you please fix the login flow…" is
 * `fix-login-flow`), short enough to read at a glance.
 */
export function branchSlug(task: string): string {
  const words = wordsOf(task.slice(0, 300));
  const kept = words.filter((word) => !FILLER.includes(word));
  return joinSlug(kept.length ? kept : words, 4, 28) || "thread";
}

/**
 * A model's branch name as a slug: its first line, without a label, quotes,
 * a `ta/` prefix or a conventional `type/` slash; `null` when nothing usable
 * is left.
 */
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

/** Where a new project's branches live, until its settings say otherwise. */
export const DEFAULT_BRANCH_PREFIX = "ta/";

/** A branch under the project's prefix: `ta/fix-login`. */
export const branchName = (prefix: string, slug: string) => `${prefix}${slug}`;

/**
 * A branch prefix as typed, ready to put before a slug: trimmed, with a `/`
 * added after a bare word (`ashik` → `ashik/`), or empty for none. `null`
 * when git could not name a branch with it.
 */
export function cleanBranchPrefix(raw: string): string | null {
  const text = raw.trim();
  if (!text) return "";
  if (!/^[A-Za-z0-9._/-]+$/.test(text)) return null;
  if (/^[/.-]|\.\.|\/\/|\/\.|\.lock(\/|$)/.test(text)) return null;
  return /[/_-]$/.test(text) ? text : `${text}/`;
}

/** A glob over repository paths (`**` any depth, `*` one segment), as protected paths use. */
export function matchesGlob(path: string, glob: string): boolean {
  const pattern = glob
    .split("**")
    .map((part) =>
      part
        .split("*")
        .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
        .join("[^/]*"),
    )
    .join(".*");
  return new RegExp(`^${pattern}$`).test(path);
}

export function createWorkspace(options: WorkspaceOptions): Workspace {
  const { exec } = options;
  const remote = options.remoteUrl ?? githubUrl;

  async function run(command: string, timeoutMs = GIT_TIMEOUT_MS): Promise<ExecResult> {
    return exec(command, { timeoutMs });
  }

  async function must(command: string, what: string, timeoutMs?: number): Promise<string> {
    const result = await run(command, timeoutMs);
    if (result.exitCode !== 0) throw new WorkspaceError(`${what}: ${tail(result)}`);
    return result.stdout;
  }

  /**
   * Run a git command that talks to GitHub with the credential in that
   * command alone. Credential helpers configured elsewhere are cleared first
   * (`credential.helper=`), so only this one answers.
   */
  async function authed(git: string): Promise<ExecResult> {
    if (options.credential.kind === "gh") {
      return exec(
        `git -c credential.helper= -c ${q("credential.helper=!gh auth git-credential")} ${git}`,
        { timeoutMs: GIT_TIMEOUT_MS },
      );
    }
    const token = await options.credential.token();
    const helper = `credential.helper=!f() { echo username=x-access-token; echo "password=$GH_TOKEN"; }; f`;
    return exec(
      `IFS= read -r GH_TOKEN; export GH_TOKEN; git -c credential.helper= -c ${q(helper)} ${git}`,
      { stdin: `${token}\n`, timeoutMs: GIT_TIMEOUT_MS },
    );
  }

  const git = (path: string) => `git -C ${q(path)}`;

  /** The shared git reads (`@tiny-agents/git`) on this worktree, over the exec port. */
  function reads(root: string): GitReadPort {
    const at = (rel: string) => q(`${root}/${rel}`);
    return {
      git: (args) => run(`${git(root)} ${args.map(q).join(" ")}`),
      async fileSize(rel) {
        const result = await run(`test -f ${at(rel)} && stat -c %s -- ${at(rel)}`, 30_000);
        return result.exitCode === 0 ? Number(result.stdout.trim()) : null;
      },
      async readFile(rel) {
        const result = await run(`cat -- ${at(rel)}`);
        return result.exitCode === 0 ? result.stdout : null;
      },
      async stats(rels) {
        // `%y` carries nanoseconds on every GNU stat; a missing path prints `-`.
        const result = await exec(
          `cd ${q(root)} && while IFS= read -r -d '' f; do stat -c '%s %y' -- "$f" 2>/dev/null || echo -; done`,
          { stdin: `${rels.join("\0")}\0`, timeoutMs: 30_000 },
        );
        return result.stdout;
      },
    };
  }

  /** Listed files with each live one's blob id; a file gone mid-read lists again once. */
  async function hashed(
    root: string,
    list: () => Promise<ChangedFile[]>,
  ): Promise<Array<GitFile & { hash: string }>> {
    for (let attempt = 0; ; attempt++) {
      const files = await list();
      const live = files.filter((f) => f.status !== "deleted").map((f) => f.path);
      const result = live.length
        ? await run(`${git(root)} hash-object -- ${live.map(q).join(" ")}`)
        : { stdout: "", stderr: "", exitCode: 0 };
      if (result.exitCode !== 0 && attempt === 0) continue;
      const hashes = result.exitCode === 0 ? result.stdout.split("\n").filter(Boolean) : [];
      const hashOf = new Map(live.map((file, i) => [file, hashes[i] ?? ""]));
      return files.map((f) => ({
        ...f,
        isGenerated: isGenerated(f.path),
        hash: f.status === "deleted" ? "deleted" : (hashOf.get(f.path) ?? ""),
      }));
    }
  }

  return {
    async tools() {
      const result = await run(
        `command -v git >/dev/null && echo git; command -v gh >/dev/null && echo gh; true`,
        30_000,
      );
      const found = new Set(result.stdout.split(/\s+/));
      return { git: found.has("git"), gh: found.has("gh") };
    },
    async home() {
      return (await must(`printf %s "$HOME"`, "Could not read the sandbox home", 30_000)).trim();
    },
    async exists(path) {
      return (await run(`test -e ${q(path)}`, 30_000)).exitCode === 0;
    },
    async clone(repo, path) {
      await must(`mkdir -p ${q(path.replace(/\/[^/]+$/, "") || "/")}`, "Could not make the folder");
      const result = await authed(`clone --quiet ${q(remote(repo))} ${q(path)}`);
      if (result.exitCode !== 0) throw new WorkspaceError(`Could not clone: ${tail(result)}`);
    },
    async addWorktree(checkout, path, branch, base) {
      const fetched = await authed(`-C ${q(checkout)} fetch --quiet origin ${q(base)}`);
      if (fetched.exitCode !== 0) {
        throw new WorkspaceError(`Could not fetch ${base}: ${tail(fetched)}`);
      }
      await must(
        `${git(checkout)} worktree add --quiet -b ${q(branch)} ${q(path)} ${q(`origin/${base}`)}`,
        "Could not make the worktree",
      );
      return (await must(`${git(path)} rev-parse HEAD`, "Could not read HEAD")).trim();
    },
    async pullWorktree(checkout, path, number, base) {
      const ref = `refs/remotes/origin/pull/${number}`;
      const fetched = await authed(
        `-C ${q(checkout)} fetch --quiet origin ${q(`+refs/pull/${number}/head:${ref}`)} ${q(`+refs/heads/${base}:refs/remotes/origin/${base}`)}`,
      );
      if (fetched.exitCode !== 0) {
        throw new WorkspaceError(`Could not fetch pull request #${number}: ${tail(fetched)}`);
      }
      const head = (
        await must(`${git(checkout)} rev-parse ${q(ref)}`, "Could not read the head")
      ).trim();
      if (!(await run(`test -e ${q(path)}`, 30_000)).exitCode) {
        const dirty = await must(
          `git --no-optional-locks -C ${q(path)} status --porcelain`,
          "Could not read the status",
        );
        // Changes made during the review stay where they are, on the head they were made on.
        if (!dirty.trim()) {
          await must(
            `${git(path)} checkout --quiet --detach ${q(head)}`,
            "Could not move to the head",
          );
        }
        return (await must(`${git(path)} rev-parse HEAD`, "Could not read HEAD")).trim();
      }
      await must(
        `${git(checkout)} worktree add --quiet --detach ${q(path)} ${q(head)}`,
        "Could not make the worktree",
      );
      return head;
    },
    async branchTaken(checkout, branch) {
      for (const ref of [`refs/heads/${branch}`, `refs/remotes/origin/${branch}`]) {
        const found = await run(`${git(checkout)} rev-parse --verify --quiet ${q(ref)}`);
        if (found.exitCode === 0) return true;
      }
      return false;
    },
    async addWorktreeForBranch(checkout, path, branch) {
      const local = await run(
        `${git(checkout)} rev-parse --verify --quiet ${q(`refs/heads/${branch}`)}`,
      );
      if (local.exitCode !== 0) {
        const fetched = await authed(
          `-C ${q(checkout)} fetch --quiet origin ${q(`refs/heads/${branch}:refs/heads/${branch}`)}`,
        );
        if (fetched.exitCode !== 0) {
          throw new WorkspaceError(`No branch ${branch}: ${tail(fetched)}`, "missing");
        }
      }
      await must(
        `${git(checkout)} worktree add --quiet ${q(path)} ${q(branch)}`,
        "Could not make the worktree",
      );
    },
    async removeWorktree(checkout, path) {
      await run(`${git(checkout)} worktree remove --force ${q(path)}`);
      await run(`${git(checkout)} worktree prune`);
    },
    async headSha(path) {
      return (await must(`${git(path)} rev-parse HEAD`, "Could not read HEAD")).trim();
    },
    async uncommitted(path) {
      const out = await must(
        `git --no-optional-locks -C ${q(path)} status --porcelain`,
        "Could not read the status",
      );
      return out.split("\n").filter(Boolean);
    },
    async baseFiles(path, base) {
      const mb = await mergeBase(path, base);
      return hashed(path, () => changedFiles(reads(path), mb));
    },
    async baseFile(path, base, file) {
      const mb = await mergeBase(path, base);
      return fileSides(reads(path), file, { rev: mb }, { worktree: true });
    },
    async sinceFiles(path, sha) {
      await haveCommit(path, sha);
      return hashed(path, () => changedFiles(reads(path), sha));
    },
    async sinceFile(path, sha, file) {
      await haveCommit(path, sha);
      return fileSides(reads(path), file, { rev: sha }, { worktree: true });
    },
    async changeStamp(path) {
      return changeStamp(reads(path));
    },
    async commitsAhead(path, base) {
      const out = await must(
        `${git(path)} log --format=%H%x09%s ${q(`origin/${base}..HEAD`)}`,
        "Could not list commits",
      );
      return out
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [sha, ...rest] = line.split("\t");
          return { sha: sha!, subject: rest.join("\t") };
        });
    },
    async changedPaths(path, from, to) {
      const out = await must(
        `${git(path)} diff --name-only ${q(from)} ${q(to)}`,
        "Could not list changed paths",
      );
      return out.split("\n").filter(Boolean);
    },
    async syncToRemote(path, repo, branch) {
      const fetched = await authed(
        `-C ${q(path)} fetch --quiet ${q(remote(repo))} ${q(`refs/heads/${branch}`)}`,
      );
      // No such branch on the remote yet: nothing to sync.
      if (fetched.exitCode !== 0) {
        if (/couldn't find remote ref/i.test(fetched.stderr)) return;
        throw new WorkspaceError(`Could not fetch ${branch}: ${tail(fetched)}`);
      }
      const head = (await must(`${git(path)} rev-parse HEAD`, "Could not read HEAD")).trim();
      const theirs = (
        await must(`${git(path)} rev-parse FETCH_HEAD`, "Could not read FETCH_HEAD")
      ).trim();
      if (head === theirs) return;
      const behind = await run(`${git(path)} merge-base --is-ancestor HEAD FETCH_HEAD`);
      if (behind.exitCode === 0) {
        await must(`${git(path)} merge --ff-only --quiet FETCH_HEAD`, "Could not fast-forward");
        return;
      }
      const ahead = await run(`${git(path)} merge-base --is-ancestor FETCH_HEAD HEAD`);
      if (ahead.exitCode === 0) return;
      throw new WorkspaceError(
        `The branch ${branch} on GitHub and the worktree have both moved; reconcile them in the thread.`,
        "diverged",
      );
    },
    async push(path, repo, branch) {
      const sha = (await must(`${git(path)} rev-parse HEAD`, "Could not read HEAD")).trim();
      const result = await authed(
        `-C ${q(path)} -c core.hooksPath=/dev/null push --quiet --no-verify ${q(remote(repo))} ${q(`HEAD:refs/heads/${branch}`)}`,
      );
      if (result.exitCode !== 0) {
        const rejected = /rejected|non-fast-forward|fetch first/i.test(result.stderr);
        throw new WorkspaceError(
          rejected
            ? `GitHub rejected the push: ${branch} moved there. The app never force-pushes.`
            : `Could not push: ${tail(result)}`,
          rejected ? "rejected" : "failed",
        );
      }
      return sha;
    },
    async commitAll(path, message, as) {
      const named = await run(`${git(path)} config user.email`, 30_000);
      const identity =
        named.exitCode === 0 && named.stdout.trim()
          ? ""
          : `-c ${q(`user.name=${as.name}`)} -c ${q(`user.email=${as.email}`)} `;
      await must(
        `${git(path)} add -A && ${git(path)} ${identity}-c core.hooksPath=/dev/null commit --quiet --no-verify -m ${q(message)}`,
        "Could not commit",
      );
    },
    async discard(path, sha) {
      if (!/^[0-9a-f]{40}$/.test(sha)) throw new WorkspaceError("Not a commit sha");
      await must(
        `${git(path)} reset --hard --quiet ${q(sha)} && ${git(path)} clean -fdq`,
        "Could not discard the changes",
      );
    },
    async hunks(path, file, from, to, context = 0) {
      const base = /^merge-base:(.+):([0-9a-f]{40})$/.exec(from);
      const start = base
        ? (
            await must(
              `${git(path)} merge-base ${q(base[2]!)} ${q(`origin/${base[1]}`)}`,
              "Could not find the merge base",
            )
          ).trim()
        : from;
      return fileHunks(reads(path), file, start, to, context);
    },
    async installTrailer(path, hooksDir, trailer) {
      // Per-worktree config, as `git sparse-checkout` sets it up.
      await must(
        `${git(path)} config core.repositoryformatversion 1 && ${git(path)} config extensions.worktreeConfig true`,
        "Could not enable per-worktree config",
      );
      const own = await run(`${git(path)} config --get core.hooksPath`);
      const original =
        own.exitCode === 0 && own.stdout.trim()
          ? own.stdout.trim()
          : `${(await must(`${git(path)} rev-parse --path-format=absolute --git-common-dir`, "Could not find the repository")).trim()}/hooks`;
      // A relative hooks path (husky's `.husky/_`) is relative to the worktree's top.
      const resolve = [
        `orig=${q(original)}`,
        `case "$orig" in /*) ;; *) orig="$(git rev-parse --show-toplevel)/$orig" ;; esac`,
      ];
      const chain = (name: string) =>
        [`[ -x "$orig/${name}" ] && exec "$orig/${name}" "$@"`, "exit 0"].join("\n");
      const scripts = HOOK_NAMES.map((name) => {
        const body =
          name === "commit-msg"
            ? [
                `git interpret-trailers --in-place --if-exists doNothing --trailer ${q(trailer)} "$1" || exit 1`,
                ...resolve,
                chain(name),
              ]
            : [...resolve, chain(name)];
        return { name, text: ["#!/bin/sh", ...body, ""].join("\n") };
      });
      for (const script of scripts) {
        const file = `${hooksDir}/${script.name}`;
        const result = await exec(
          `mkdir -p ${q(hooksDir)} && cat > ${q(file)} && chmod +x ${q(file)}`,
          { stdin: script.text, timeoutMs: 30_000 },
        );
        if (result.exitCode !== 0)
          throw new WorkspaceError(`Could not write a hook: ${tail(result)}`);
      }
      await must(
        `${git(path)} config --worktree core.hooksPath ${q(hooksDir)}`,
        "Could not point the worktree at its hooks",
      );
    },
    async checkpoint(path, ref) {
      const script = [
        `cd ${q(path)}`,
        `tmp=$(mktemp)`,
        `trap 'rm -f "$tmp"' EXIT`,
        `cp "$(git rev-parse --git-path index)" "$tmp" 2>/dev/null || true`,
        `export GIT_INDEX_FILE="$tmp"`,
        `git add -A >/dev/null`,
        `tree=$(git write-tree)`,
        `sha=$(${CHECKPOINT_ID} git commit-tree "$tree" -p HEAD -m "tiny-agents checkpoint")`,
        `git update-ref ${q(ref)} "$sha"`,
        `echo "$sha"`,
      ].join(" && ");
      return (await must(`bash -c ${q(script)}`, "Could not make a checkpoint")).trim();
    },
    async rangeFiles(path, from, to) {
      const files = await changedFiles(reads(path), from, to);
      const live = files.filter((f) => f.status !== "deleted");
      const ids = live.length
        ? await must(
            `${git(path)} ls-tree -z ${q(to)} -- ${live.map((f) => q(f.path)).join(" ")}`,
            "Could not read the tree",
          )
        : "";
      // `<mode> blob <id>\t<path>` records.
      const hashOf = new Map(
        ids
          .split("\0")
          .filter(Boolean)
          .map((record) => {
            const tab = record.indexOf("\t");
            return [record.slice(tab + 1), record.slice(0, tab).split(" ")[2] ?? ""] as const;
          }),
      );
      return files.map((f) => ({
        ...f,
        isGenerated: isGenerated(f.path),
        hash: f.status === "deleted" ? "deleted" : (hashOf.get(f.path) ?? ""),
      }));
    },
    async rangeFile(path, from, to, file) {
      return fileSides(reads(path), file, { rev: from }, { rev: to });
    },
    async restore(path, sha) {
      await must(
        `${git(path)} add -A && ${git(path)} read-tree -u --reset ${q(`${sha}^{tree}`)} && ${git(path)} reset -q`,
        "Could not restore the checkpoint",
      );
    },
    async readScripts(path) {
      const result = await run(`cat -- ${q(`${path}/${SCRIPTS_FILE}`)}`, 30_000);
      if (result.exitCode !== 0) return {};
      return parseScripts(result.stdout);
    },
    async runScript(path, script) {
      const result = await exec(`cd ${q(path)} && bash -c ${q(script)}`, {
        timeoutMs: SCRIPT_TIMEOUT_MS,
      });
      return {
        ok: result.exitCode === 0,
        output: `${result.stdout}${result.stderr ? `\n${result.stderr}` : ""}`.trim().slice(-4000),
      };
    },
  };

  /** Fetch commit `sha` unless the worktree has it (GitHub serves a reachable commit by sha). */
  async function haveCommit(path: string, sha: string): Promise<void> {
    if (!/^[0-9a-f]{40}$/.test(sha)) throw new WorkspaceError("Not a commit sha");
    if ((await run(`${git(path)} cat-file -e ${q(`${sha}^{commit}`)}`, 30_000)).exitCode === 0) {
      return;
    }
    const fetched = await authed(`-C ${q(path)} fetch --quiet origin ${q(sha)}`);
    if (fetched.exitCode !== 0) {
      throw new WorkspaceError(
        "The commit you last reviewed is no longer on GitHub (the branch was likely force-pushed).",
      );
    }
  }

  async function mergeBase(path: string, base: string): Promise<string> {
    return (
      await must(
        `${git(path)} merge-base HEAD ${q(`origin/${base}`)}`,
        "Could not find the merge base",
      )
    ).trim();
  }
}

/** The scripts file's `setup`, `check` and `archive`; anything else is ignored. */
function parseScripts(raw: string): ProjectScripts {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const out: ProjectScripts = {};
    for (const key of ["setup", "check", "archive"] as const) {
      const script = value?.[key];
      if (typeof script === "string" && script.trim()) out[key] = script.trim();
    }
    return out;
  } catch {
    return {};
  }
}
