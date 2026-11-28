import { parseJson } from "@tiny-agents/std";
import { z } from "zod";
import { Boom } from "@groot/core/errors";
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

type GitCredential = { kind: "gh" } | { kind: "token"; token: () => Promise<string> };

export interface WorkspaceOptions {
  exec: ExecPort;
  credential: GitCredential;
  remoteUrl?: (repo: RepoRef) => string;
}

export class WorkspaceError extends Error {
  constructor(
    message: string,
    readonly code: "rejected" | "denied" | "diverged" | "missing" | "failed" = "failed",
  ) {
    super(message);
    this.name = "WorkspaceError";
  }
}

export function saying(error: unknown): never {
  if (error instanceof WorkspaceError) throw Boom.conflict(error.message);
  throw error;
}

export interface ProjectScripts {
  setup?: string;
  check?: string;
  archive?: string;
}

const SCRIPTS_FILE = ".tiny-agents/code.json";

const GIT_TIMEOUT_MS = 5 * 60_000;
const SCRIPT_TIMEOUT_MS = 15 * 60_000;

const githubUrl = (repo: RepoRef) => `https://github.com/${repo.owner}/${repo.name}.git`;

const tail = (result: ExecResult, chars = 2000) =>
  (result.stderr.trim() || result.stdout.trim()).slice(-chars);

export interface Workspace {
  tools(): Promise<{ git: boolean; gh: boolean }>;
  home(): Promise<string>;
  exists(path: string): Promise<boolean>;
  clone(repo: RepoRef, path: string): Promise<void>;
  addWorktree(checkout: string, path: string, branch: string, base: string): Promise<string>;
  addWorktreeForBranch(checkout: string, path: string, branch: string): Promise<void>;
  fetchPull(checkout: string, number: number, base: string): Promise<string>;
  pullWorktree(checkout: string, path: string, head: string): Promise<string>;
  branchTaken(checkout: string, branch: string): Promise<boolean>;
  removeWorktree(checkout: string, path: string): Promise<void>;
  headSha(path: string): Promise<string>;
  currentBranch(path: string): Promise<string | null>;
  uncommitted(path: string): Promise<string[]>;
  files(path: string, from: string, to?: string): Promise<Array<GitFile & { hash: string }>>;
  file(path: string, file: string, from: string, to?: string): Promise<FileContents>;
  changeStamp(path: string): Promise<string>;
  commitsAhead(path: string, base: string): Promise<Array<{ sha: string; subject: string }>>;
  commitsSince(path: string, sha: string): Promise<number>;
  landedIn(path: string, base: string): Promise<"github" | "local" | null>;
  pushBase(path: string, repo: RepoRef, base: string): Promise<void>;
  changedPaths(path: string, from: string, to: string): Promise<string[]>;
  syncToRemote(path: string, repo: RepoRef, branch: string): Promise<void>;
  push(path: string, repo: RepoRef, branch: string): Promise<string>;
  commitAll(path: string, message: string, as: { name: string; email: string }): Promise<void>;
  writeFile(
    path: string,
    file: string,
    expected: string,
    content: string,
  ): Promise<"written" | "outside" | "changed">;
  listFiles(path: string): Promise<string[]>;
  readText(path: string, file: string): Promise<{ content: string } | "outside" | "unshowable">;
  search(path: string, query: string): Promise<Array<{ path: string; line: number; text: string }>>;
  discard(path: string, sha: string): Promise<void>;
  hunks(
    path: string,
    file: string,
    from: string,
    to: string | null,
    context?: number,
  ): Promise<Hunk[]>;
  readScripts(path: string): Promise<ProjectScripts>;
  runScript(path: string, script: string): Promise<{ ok: boolean; output: string }>;
  installTrailer(path: string, hooksDir: string, trailer: string): Promise<void>;
  checkpoint(path: string, ref: string): Promise<string>;
  restore(path: string, sha: string): Promise<void>;
}

type FileContents = Omit<GitFileDiff, "path">;

const MAX_LISTED_FILES = 20_000;
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_SEARCH_HITS = 200;

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

const CHECKPOINT_ID =
  "GIT_AUTHOR_NAME=tiny-agents GIT_AUTHOR_EMAIL=checkpoints@tiny-agents.invalid " +
  "GIT_COMMITTER_NAME=tiny-agents GIT_COMMITTER_EMAIL=checkpoints@tiny-agents.invalid";

export function checkpointRef(branch: string, seq: number): string {
  return `refs/tiny-agents/checkpoints/${branch.replaceAll("/", "_")}/${seq}`;
}

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

  function pushFailure(result: ExecResult, branch: string, what: string): WorkspaceError {
    const said = result.stderr;
    if (/without `?workflow`? scope|workflows? permission/i.test(said)) {
      const fix =
        options.credential.kind === "gh"
          ? "the GitHub login lacks the workflow scope. Run `gh auth refresh -h github.com -s workflow`, then push again."
          : "the GitHub token lacks write access to workflows. Grant it Workflows: write, then push again.";
      return new WorkspaceError(
        `GitHub refused the push: it changes .github/workflows and ${fix}`,
        "denied",
      );
    }
    if (/\[remote rejected\]|^remote: (error|fatal)/im.test(said)) {
      return new WorkspaceError(`GitHub refused the push: ${tail(result, 600)}`, "denied");
    }
    if (/\[rejected\]|non-fast-forward|fetch first/i.test(said)) {
      return new WorkspaceError(
        `GitHub rejected the push: ${branch} on GitHub has commits this worktree lacks. The app never force-pushes.`,
        "rejected",
      );
    }
    return new WorkspaceError(`${what}: ${tail(result)}`);
  }

  async function must(command: string, what: string, timeoutMs?: number): Promise<string> {
    const result = await run(command, timeoutMs);
    if (result.exitCode !== 0) throw new WorkspaceError(`${what}: ${tail(result)}`);
    return result.stdout;
  }

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
        const result = await exec(
          `cd ${q(root)} && while IFS= read -r -d '' f; do stat -c '%s %y' -- "$f" 2>/dev/null || echo -; done`,
          { stdin: `${rels.join("\0")}\0`, timeoutMs: 30_000 },
        );
        return result.stdout;
      },
    };
  }

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

  async function treeHashed(
    path: string,
    from: string,
    to: string,
  ): Promise<Array<GitFile & { hash: string }>> {
    const files = await changedFiles(reads(path), from, to);
    const live = files.filter((f) => f.status !== "deleted");
    const ids = live.length
      ? await must(
          `${git(path)} ls-tree -z ${q(to)} -- ${live.map((f) => q(f.path)).join(" ")}`,
          "Could not read the tree",
        )
      : "";
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
    async fetchPull(checkout, number, base) {
      const ref = `refs/remotes/origin/pull/${number}`;
      const fetched = await authed(
        `-C ${q(checkout)} fetch --quiet origin ${q(`+refs/pull/${number}/head:${ref}`)} ${q(`+refs/heads/${base}:refs/remotes/origin/${base}`)}`,
      );
      if (fetched.exitCode !== 0) {
        throw new WorkspaceError(`Could not fetch pull request #${number}: ${tail(fetched)}`);
      }
      return (await must(`${git(checkout)} rev-parse ${q(ref)}`, "Could not read the head")).trim();
    },
    async pullWorktree(checkout, path, head) {
      if (!(await run(`test -e ${q(path)}`, 30_000)).exitCode) {
        const dirty = await must(
          `git --no-optional-locks -C ${q(path)} status --porcelain`,
          "Could not read the status",
        );
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
      const listed = await authed(
        `-C ${q(checkout)} ls-remote --exit-code --heads origin ${q(`refs/heads/${branch}`)}`,
      );
      return listed.exitCode === 0;
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
    async currentBranch(path) {
      const name = (
        await must(`${git(path)} rev-parse --abbrev-ref HEAD`, "Could not read the branch")
      ).trim();
      return name && name !== "HEAD" ? name : null;
    },
    async uncommitted(path) {
      const out = await must(
        `git --no-optional-locks -C ${q(path)} status --porcelain`,
        "Could not read the status",
      );
      return out.split("\n").filter(Boolean);
    },
    async files(path, from, to) {
      const start = await resolveFrom(path, from);
      return to
        ? treeHashed(path, start, to)
        : hashed(path, () => changedFiles(reads(path), start));
    },
    async file(path, file, from, to) {
      const start = await resolveFrom(path, from);
      return fileSides(reads(path), file, { rev: start }, to ? { rev: to } : { worktree: true });
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
    async commitsSince(path, sha) {
      const out = await must(
        `${git(path)} rev-list --count ${q(`${sha}..HEAD`)}`,
        "Could not count commits",
      );
      return Number(out.trim()) || 0;
    },
    async landedIn(path, base) {
      const fetched = await authed(
        `-C ${q(path)} fetch --quiet origin ${q(`+refs/heads/${base}:refs/remotes/origin/${base}`)}`,
      );
      if (fetched.exitCode !== 0) {
        throw new WorkspaceError(`Could not fetch ${base}: ${tail(fetched)}`);
      }
      const within = async (ref: string) =>
        (await run(`${git(path)} merge-base --is-ancestor HEAD ${q(ref)}`)).exitCode === 0;
      if (await within(`refs/remotes/origin/${base}`)) return "github";
      if (await within(`refs/heads/${base}`)) return "local";
      return null;
    },
    async pushBase(path, repo, base) {
      const result = await authed(
        `-C ${q(path)} -c core.hooksPath=/dev/null push --quiet --no-verify ${q(remote(repo))} ${q(`refs/heads/${base}:refs/heads/${base}`)}`,
      );
      if (result.exitCode !== 0) {
        throw pushFailure(result, base, `Could not push ${base}`);
      }
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
        throw pushFailure(result, branch, "Could not push");
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
    async writeFile(path, file, expected, content) {
      const script = [
        `cd ${q(path)}`,
        `root=$(pwd -P)`,
        `real=$(realpath -e -- ${q(file)}) || exit 3`,
        `case "$real" in "$root"/.git|"$root"/.git/*) exit 3;; "$root"/*) ;; *) exit 3;; esac`,
        `[ -f "$real" ] || exit 3`,
        `[ "$(sha256sum < "$real" | cut -d' ' -f1)" = ${q(expected)} ] || exit 4`,
        `cat > "$real"`,
      ].join(" && ");
      const result = await exec(`bash -c ${q(script)}`, { stdin: content, timeoutMs: 30_000 });
      if (result.exitCode === 3) return "outside";
      if (result.exitCode === 4) return "changed";
      if (result.exitCode !== 0)
        throw new WorkspaceError(`Could not save ${file}: ${tail(result)}`);
      return "written";
    },
    async listFiles(path) {
      const out = await must(
        `${git(path)} ls-files -z --cached --others --exclude-standard`,
        "Could not list the files",
      );
      return out.split("\0").filter(Boolean).slice(0, MAX_LISTED_FILES).sort();
    },
    async readText(path, file) {
      const script = [
        `cd ${q(path)}`,
        `root=$(pwd -P)`,
        `real=$(realpath -e -- ${q(file)}) || exit 3`,
        `case "$real" in "$root"/.git|"$root"/.git/*) exit 3;; "$root"/*) ;; *) exit 3;; esac`,
        `[ -f "$real" ] || exit 3`,
        `[ "$(stat -c %s -- "$real")" -le ${MAX_TEXT_BYTES} ] || exit 5`,
        `if [ -s "$real" ] && ! grep -Iq . "$real"; then exit 5; fi`,
        `cat -- "$real"`,
      ].join(" && ");
      const result = await exec(`bash -c ${q(script)}`, { timeoutMs: 30_000 });
      if (result.exitCode === 3) return "outside";
      if (result.exitCode === 5) return "unshowable";
      if (result.exitCode !== 0)
        throw new WorkspaceError(`Could not read ${file}: ${tail(result)}`);
      return { content: result.stdout };
    },
    async search(path, query) {
      const result = await run(
        `${git(path)} grep -n -I --untracked --fixed-strings --ignore-case --max-count=20 -e ${q(query)}`,
        30_000,
      );
      if (result.exitCode > 1) throw new WorkspaceError(`Could not search: ${tail(result)}`);
      const hits: Array<{ path: string; line: number; text: string }> = [];
      for (const row of result.stdout.split("\n")) {
        const match = /^([^:]+):(\d+):(.*)$/.exec(row);
        if (!match) continue;
        hits.push({ path: match[1]!, line: Number(match[2]), text: match[3]!.slice(0, 300) });
        if (hits.length >= MAX_SEARCH_HITS) break;
      }
      return hits;
    },
    async discard(path, sha) {
      if (!/^[0-9a-f]{40}$/.test(sha)) throw new WorkspaceError("Not a commit sha");
      await must(
        `${git(path)} reset --hard --quiet ${q(sha)} && ${git(path)} clean -fdq`,
        "Could not discard the changes",
      );
    },
    async hunks(path, file, from, to, context = 0) {
      return fileHunks(reads(path), file, await resolveFrom(path, from), to, context);
    },
    async installTrailer(path, hooksDir, trailer) {
      await must(
        `${git(path)} config core.repositoryformatversion 1 && ${git(path)} config extensions.worktreeConfig true`,
        "Could not enable per-worktree config",
      );
      const own = await run(`${git(path)} config --get core.hooksPath`);
      const original =
        own.exitCode === 0 && own.stdout.trim()
          ? own.stdout.trim()
          : `${(await must(`${git(path)} rev-parse --path-format=absolute --git-common-dir`, "Could not find the repository")).trim()}/hooks`;
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

  async function resolveFrom(path: string, from: string): Promise<string> {
    const base = /^merge-base:([^:]+)(?::([0-9a-f]{40}))?$/.exec(from);
    if (!base) {
      await haveCommit(path, from);
      return from;
    }
    return (
      await must(
        `${git(path)} merge-base ${q(base[2] ?? "HEAD")} ${q(`origin/${base[1]}`)}`,
        "Could not find the merge base",
      )
    ).trim();
  }
}

function parseScripts(raw: string): ProjectScripts {
  try {
    const value = parseJson("A project's scripts", raw, z.record(z.string(), z.unknown()));
    const out: ProjectScripts = {};
    for (const key of ["setup", "check", "archive"] as const) {
      const script = value[key];
      if (typeof script === "string" && script.trim()) out[key] = script.trim();
    }
    return out;
  } catch {
    return {};
  }
}
