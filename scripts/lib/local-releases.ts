import { fork, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { UpdateCommit, UpdateRelease } from "../../apps/web/src/shared/local-updates";
import type { CheckResult, ServerHandle } from "./local-supervisor";

const BUILT_MARKER = ".tiny-agents-built";
const STOP_GRACE_MS = 30_000;

export type Track =
  | { kind: "branch"; remote: string; branch: string }
  | { kind: "release"; remote: string };

export function trackLabel(track: Track): string {
  return track.kind === "branch" ? `${track.remote}/${track.branch}` : "latest release";
}

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
  } catch {}
  return { sha: full, version, subject, committedAt: Number(time) * 1000 };
}

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

export function defaultReleasesDir(): string {
  return path.join(os.homedir(), ".tiny-agents", "releases");
}

export function releaseStore(root: string, dir: string) {
  const releaseDir = (sha: string) => path.join(dir, sha);
  const currentFile = path.join(dir, "current");

  const isBuilt = (sha: string) => existsSync(path.join(releaseDir(sha), BUILT_MARKER));

  async function removeReleases(targets: string[]): Promise<void> {
    await Promise.all(targets.map((target) => rm(target, { recursive: true, force: true })));
    await git(root, ["worktree", "prune"]);
  }

  return {
    releaseDir,
    isBuilt,

    readCurrent(): string | undefined {
      if (!existsSync(currentFile)) return undefined;
      const sha = readFileSync(currentFile, "utf8").trim();
      return sha && isBuilt(sha) ? sha : undefined;
    },

    saveCurrent(sha: string): void {
      mkdirSync(dir, { recursive: true });
      writeFileSync(currentFile, `${sha}\n`);
    },

    async build(sha: string, onLine: (line: string) => void): Promise<void> {
      const target = releaseDir(sha);
      mkdirSync(dir, { recursive: true });
      await removeReleases(existsSync(target) ? [target] : []);
      onLine(`$ git worktree add ${target} ${sha.slice(0, 7)}`);
      await git(root, ["worktree", "add", "--detach", "--force", target, sha]);

      const env = { ...process.env };
      delete env.NODE_ENV;
      const pnpm = async (args: string[]) => {
        onLine(`$ pnpm ${args.join(" ")}`);
        const result = await run("pnpm", args, { cwd: target, env, onLine });
        if (result.code !== 0) throw new Error(`pnpm ${args.join(" ")} exited ${result.code}`);
      };
      await pnpm(["install", "--frozen-lockfile"]);
      await pnpm(["run", "build"]);
      writeFileSync(path.join(target, BUILT_MARKER), `${new Date().toISOString()}\n`);
    },

    async prune(keep: string[]): Promise<void> {
      if (!existsSync(dir)) return;
      const kept = new Set(keep);
      const entries = await readdir(dir, { withFileTypes: true });
      await removeReleases(
        entries
          .filter((entry) => entry.isDirectory() && !kept.has(entry.name))
          .map((entry) => path.join(dir, entry.name)),
      );
    },

    launch(sha: string): ServerHandle {
      return launchBundle(root, path.join(releaseDir(sha), "dist/server/bundle.js"));
    },
  };
}

function launchBundle(root: string, bundle: string): ServerHandle {
  const child = fork(bundle, [], {
    cwd: root,
    env: { ...process.env, NODE_ENV: "production", TINY_AGENTS_SUPERVISED: "1" },
    execArgv: [],
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
