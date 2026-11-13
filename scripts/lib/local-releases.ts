/**
 * Releases for `pnpm local` (docs/guides/local-updates.md): each one is a
 * detached git worktree of one commit under `~/.tiny-agents/releases/<sha>`,
 * with its own `node_modules` (hard links into the pnpm store) and its own
 * `dist/`. A new release builds there while the old one keeps serving, so
 * swapping is only a restart. `current` in that folder names the release to run.
 */
import { fork, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { UpdateCommit, UpdateRelease } from "../../apps/web/src/shared/local-updates";
import type { CheckResult, ServerHandle } from "./local-supervisor";

const BUILT_MARKER = ".tiny-agents-built";
const STOP_GRACE_MS = 30_000;

/** What `pnpm local` follows: a branch on the remote, or the newest `v*` release tag. */
export type Track =
  | { kind: "branch"; remote: string; branch: string }
  | { kind: "release"; remote: string };

export function trackLabel(track: Track): string {
  return track.kind === "branch" ? `${track.remote}/${track.branch}` : "latest release";
}

/** Run git in `cwd`; resolves stdout, rejects with stderr. */
export function git(cwd: string, args: string[]): Promise<string> {
  return run("git", args, { cwd }).then((result) => {
    if (result.code !== 0) {
      throw new Error(result.stderr.trim() || `git ${args.join(" ")} exited ${result.code}`);
    }
    return result.stdout;
  });
}

function run(
  command: string,
  args: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv; onLine?: (line: string) => void },
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    let stdout = "";
    let stderr = "";
    const lines = (chunk: Buffer) => {
      for (const line of chunk.toString().split(/\r?\n/)) {
        if (line.trim()) options.onLine?.(line);
      }
    };
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      lines(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      lines(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

/** Fetch the tracked ref and resolve it to a commit. */
export async function fetchTracked(root: string, track: Track): Promise<string> {
  if (track.kind === "branch") {
    await git(root, ["fetch", "--quiet", track.remote, track.branch]);
    return (await git(root, ["rev-parse", "FETCH_HEAD^{commit}"])).trim();
  }
  await git(root, ["fetch", "--quiet", "--tags", track.remote]);
  const tags = (await git(root, ["tag", "--list", "v*", "--sort=-v:refname"])).trim();
  const newest = tags.split("\n")[0];
  if (!newest) throw new Error(`No v* release tags on ${track.remote}`);
  return (await git(root, ["rev-parse", `${newest}^{commit}`])).trim();
}

export async function releaseInfo(root: string, sha: string): Promise<UpdateRelease> {
  const [full, subject, time] = (await git(root, ["show", "-s", "--format=%H%x00%s%x00%ct", sha]))
    .trim()
    .split("\0");
  let version = "unknown";
  try {
    const manifest = JSON.parse(await git(root, ["show", `${full}:package.json`])) as {
      version?: string;
    };
    version = manifest.version ?? version;
  } catch {
    // A commit without a readable package.json still runs; it just has no version.
  }
  return { sha: full, version, subject, committedAt: Number(time) * 1000 };
}

/** Commits in `to` not in `from`, newest first, and whether the sandbox image changed. */
export async function compare(
  root: string,
  from: string,
  to: string,
): Promise<Omit<CheckResult, "latest">> {
  if (from === to) return { commits: [], sandboxChanged: false };
  const log = await git(root, ["log", "--format=%h%x00%s", "-n", "50", `${from}..${to}`]);
  const commits: UpdateCommit[] = log
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sha, subject] = line.split("\0");
      return { sha, subject };
    });
  const diff = await run("git", ["diff", "--quiet", from, to, "--", "docker/sandbox"], {
    cwd: root,
  });
  return { commits, sandboxChanged: diff.code === 1 };
}

/** Where release worktrees live, outside the checkout so editors and tools never scan them. */
export function defaultReleasesDir(): string {
  return path.join(os.homedir(), ".tiny-agents", "releases");
}

/** The release worktrees of one checkout (`root`), kept in `dir`. */
export function releaseStore(root: string, dir: string) {
  const releaseDir = (sha: string) => path.join(dir, sha);
  const currentFile = path.join(dir, "current");

  const isBuilt = (sha: string) => existsSync(path.join(releaseDir(sha), BUILT_MARKER));

  async function removeRelease(target: string): Promise<void> {
    await git(root, ["worktree", "remove", "--force", target]).catch(() => undefined);
    rmSync(target, { recursive: true, force: true });
    await git(root, ["worktree", "prune"]);
  }

  return {
    releaseDir,
    isBuilt,

    /** The release `pnpm local` ran last, if it is still built. */
    readCurrent(): string | undefined {
      if (!existsSync(currentFile)) return undefined;
      const sha = readFileSync(currentFile, "utf8").trim();
      return sha && isBuilt(sha) ? sha : undefined;
    },

    saveCurrent(sha: string): void {
      mkdirSync(dir, { recursive: true });
      writeFileSync(currentFile, `${sha}\n`);
    },

    /** Check out `sha` as a worktree, install and build it. A half-built one is started over. */
    async build(sha: string, onLine: (line: string) => void): Promise<void> {
      const target = releaseDir(sha);
      mkdirSync(dir, { recursive: true });
      if (existsSync(target)) await removeRelease(target);
      await git(root, ["worktree", "prune"]);
      onLine(`$ git worktree add ${target} ${sha.slice(0, 7)}`);
      await git(root, ["worktree", "add", "--detach", "--force", target, sha]);

      // The build is for production but needs dev dependencies (Vite,
      // esbuild): never pass the server's NODE_ENV down.
      const env = { ...process.env };
      delete env.NODE_ENV;
      for (const args of [
        ["install", "--frozen-lockfile"],
        ["run", "build"],
      ]) {
        onLine(`$ pnpm ${args.join(" ")}`);
        const result = await run("pnpm", args, { cwd: target, env, onLine });
        if (result.code !== 0) throw new Error(`pnpm ${args.join(" ")} exited ${result.code}`);
      }
      writeFileSync(path.join(target, BUILT_MARKER), `${new Date().toISOString()}\n`);
    },

    /** Remove every release worktree but `keep`. */
    async prune(keep: string[]): Promise<void> {
      if (!existsSync(dir)) return;
      const kept = new Set(keep);
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (!entry.isDirectory() || kept.has(entry.name)) continue;
        await removeRelease(path.join(dir, entry.name));
      }
    },

    /**
     * Start a release's server bundle. The working directory stays the main
     * checkout, so `.env`, `data/` and relative paths in it mean what they
     * mean for `pnpm start`; the bundle finds its client, migrations and npm
     * dependencies beside itself.
     */
    launch(sha: string): ServerHandle {
      return launchBundle(root, path.join(releaseDir(sha), "dist/server/bundle.js"));
    },
  };
}

function launchBundle(root: string, bundle: string): ServerHandle {
  const child = fork(bundle, [], {
    cwd: root,
    // TINY_AGENTS_SUPERVISED (updates.service.ts): talk to this supervisor over IPC.
    env: { ...process.env, NODE_ENV: "production", TINY_AGENTS_SUPERVISED: "1" },
    // Not the supervisor's own tsx loader.
    execArgv: [],
    // Its own process group: Ctrl+C in the terminal reaches only the
    // supervisor, which stops the server once (a second signal would make
    // the server skip its graceful shutdown).
    detached: process.platform !== "win32",
    stdio: ["inherit", "inherit", "inherit", "ipc"],
  });
  let exited = child.exitCode !== null;
  const exit = new Promise<void>((resolve) => {
    child.once("exit", () => {
      exited = true;
      resolve();
    });
  });
  // Never leave the server running (it holds the agent store's lock) when
  // the supervisor itself goes away.
  const orphanGuard = () => child.kill("SIGTERM");
  process.once("exit", orphanGuard);
  void exit.then(() => process.off("exit", orphanGuard));
  return {
    send: (message) => {
      if (child.connected) child.send(message as object);
    },
    onMessage: (listener) => child.on("message", listener),
    onExit: (listener) => child.once("exit", (code) => listener(code)),
    stop: async () => {
      if (exited) return;
      child.kill("SIGTERM");
      const timer = setTimeout(() => child.kill("SIGKILL"), STOP_GRACE_MS);
      await exit;
      clearTimeout(timer);
    },
  };
}
