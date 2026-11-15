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
import type { GitFile } from "@tiny-agents/code/contracts";

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
  removeWorktree(checkout: string, path: string): Promise<void>;
  headSha(path: string): Promise<string>;
  /** Uncommitted changes, as `git status --porcelain` lines. */
  uncommitted(path: string): Promise<string[]>;
  /** Files changed since the merge base with `origin/<base>` (working tree included), with content hashes. */
  baseFiles(path: string, base: string): Promise<Array<GitFile & { hash: string }>>;
  /** One file's merge-base and working-tree content. */
  baseFile(
    path: string,
    base: string,
    file: string,
  ): Promise<{ oldContent: string; newContent: string }>;
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
  /** The checked-in scripts, if the file exists and parses. */
  readScripts(path: string): Promise<ProjectScripts>;
  runScript(path: string, script: string): Promise<{ ok: boolean; output: string }>;
}

/** Branch names the app makes: `ta/<slug>-<suffix>`. */
export function branchName(title: string, suffix: string): string {
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/, "") || "thread";
  return `ta/${slug}-${suffix}`;
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
      const out = await must(`${git(path)} status --porcelain`, "Could not read the status");
      return out.split("\n").filter(Boolean);
    },
    async baseFiles(path, base) {
      const mb = await mergeBase(path, base);
      const [numstat, names] = await Promise.all([
        must(`${git(path)} diff --numstat ${q(mb)}`, "Could not diff"),
        must(`${git(path)} diff --name-status --no-renames ${q(mb)}`, "Could not diff"),
      ]);
      const counts = new Map<string, { add: number; del: number }>();
      for (const line of numstat.split("\n").filter(Boolean)) {
        const [add, del, file] = line.split("\t");
        counts.set(file!, {
          add: add === "-" ? 0 : Number(add),
          del: del === "-" ? 0 : Number(del),
        });
      }
      const files = names
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [code, file] = line.split("\t") as [string, string];
          const status: GitFile["status"] =
            code === "A" ? "added" : code === "D" ? "deleted" : "modified";
          return { path: file, status };
        });
      const live = files.filter((f) => f.status !== "deleted").map((f) => f.path);
      const hashes = live.length
        ? (await must(`${git(path)} hash-object -- ${live.map(q).join(" ")}`, "Could not hash"))
            .split("\n")
            .filter(Boolean)
        : [];
      const hashOf = new Map(live.map((file, i) => [file, hashes[i] ?? ""]));
      return files.map((f) => ({
        path: f.path,
        status: f.status,
        additions: counts.get(f.path)?.add ?? 0,
        deletions: counts.get(f.path)?.del ?? 0,
        isGenerated: isGenerated(f.path),
        hash: hashOf.get(f.path) ?? "deleted",
      }));
    },
    async baseFile(path, base, file) {
      const mb = await mergeBase(path, base);
      const [old, next] = await Promise.all([
        run(`${git(path)} show ${q(`${mb}:${file}`)}`),
        run(`cat -- ${q(`${path}/${file}`)}`),
      ]);
      return {
        oldContent: old.exitCode === 0 ? old.stdout : "",
        newContent: next.exitCode === 0 ? next.stdout : "",
      };
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

const GENERATED = [
  /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|Cargo\.lock|go\.sum|poetry\.lock|composer\.lock|Gemfile\.lock)$/,
  /(^|\/)(dist|build|vendor|node_modules)\//,
  /\.min\.(js|css)$/,
  /\.snap$/,
];

function isGenerated(path: string): boolean {
  return GENERATED.some((re) => re.test(path));
}
