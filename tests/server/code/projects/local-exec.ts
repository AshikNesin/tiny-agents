import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExecPort } from "@tiny-agents/github";

export interface LocalExec {
  exec: ExecPort;
  calls: Array<{ command: string; stdin?: string }>;
  home: string;
  cleanup(): void;
}

export function localExec(): LocalExec {
  const home = mkdtempSync(join(tmpdir(), "ta-ws-"));
  const calls: LocalExec["calls"] = [];
  const env = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: home,
    GIT_AUTHOR_NAME: "Test",
    GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "Test",
    GIT_COMMITTER_EMAIL: "test@example.com",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
  };
  const exec: ExecPort = (command, options = {}) => {
    calls.push({ command, stdin: options.stdin });
    return new Promise((resolve, reject) => {
      const child = spawn("bash", ["-c", command], { cwd: home, env });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d: Buffer) => (stdout += d.toString("utf8")));
      child.stderr.on("data", (d: Buffer) => (stderr += d.toString("utf8")));
      child.on("error", reject);
      child.stdin.on("error", () => undefined);
      child.on("close", (code) => resolve({ stdout, stderr, exitCode: code ?? 255 }));
      child.stdin.end(options.stdin ?? "");
    });
  };
  return { exec, calls, home, cleanup: () => rmSync(home, { recursive: true, force: true }) };
}

export async function sh(local: LocalExec, line: string): Promise<string> {
  const result = await local.exec(line);
  if (result.exitCode !== 0) throw new Error(`${line}: ${result.stderr}`);
  return result.stdout.trim();
}

export async function bareRepo(local: LocalExec, name = "origin.git"): Promise<string> {
  const bare = join(local.home, name);
  const seed = join(local.home, `${name}-seed`);
  await sh(
    local,
    [
      `git init --quiet --bare -b main ${bare}`,
      `git init --quiet -b main ${seed}`,
      `cd ${seed}`,
      `printf 'hello\\n' > README.md`,
      `mkdir -p src && printf 'export const a = 1;\\n' > src/a.ts`,
      `git add -A && git commit --quiet -m init`,
      `git push --quiet ${bare} main`,
    ].join(" && "),
  );
  return bare;
}
