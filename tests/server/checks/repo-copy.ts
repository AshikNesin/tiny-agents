import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

const repoRoot = process.cwd();

export type ScriptRun = { status: number | null; stdout: string; stderr: string };

export function runTsxScript(script: string, args: string[], timeout: number): Promise<ScriptRun> {
  return new Promise((resolve) => {
    const child = spawn("pnpm", ["exec", "tsx", script, ...args], { cwd: repoRoot, timeout });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

export async function withRepoCopy<T>(use: (root: string) => T | Promise<T>): Promise<T> {
  const root = mkdtempSync(path.join(tmpdir(), "repo-copy-"));
  try {
    const packages = readdirSync(path.join(repoRoot, "packages")).map((name) => `packages/${name}`);
    const copied = [
      "scripts",
      "tsconfig.json",
      "tsconfig.base.json",
      "tests/kit-consumers",
      "tests/e2e",
      "tests/test-clock.ts",
      "playwright.config.ts",
      "apps/web/tsconfig.json",
      "apps/web/src",
      ...packages.flatMap((dir) => [`${dir}/package.json`, `${dir}/src`]),
    ];
    for (const entry of copied) {
      const from = path.join(repoRoot, entry);
      if (existsSync(from)) cpSync(from, path.join(root, entry), { recursive: true });
    }
    for (const dir of [".", "apps/web", ...packages]) {
      const modules = path.join(repoRoot, dir, "node_modules");
      if (!existsSync(modules)) continue;
      mkdirSync(path.join(root, dir), { recursive: true });
      symlinkSync(modules, path.join(root, dir, "node_modules"));
    }
    return await use(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
