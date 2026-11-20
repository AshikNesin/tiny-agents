import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { withRepoCopy } from "./repo-copy";

const repoRoot = process.cwd();
const SCRIPT = path.join("scripts", "check-typecheck-coverage.ts");
const TIMEOUT = 120_000;

function runCoverageScript(checkedRepo = repoRoot): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync("pnpm", ["exec", "tsx", path.join(checkedRepo, SCRIPT)], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: TIMEOUT,
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

describe("typecheck coverage", () => {
  it(
    "owns every source file at head",
    () => {
      const run = runCoverageScript();
      expect(run.status).toBe(0);
      expect(run.stdout).toMatch(/(\d+)\/\1 source files covered/);
    },
    TIMEOUT,
  );

  it(
    "typechecks repo-owned declarations",
    () =>
      withRepoCopy((root) => {
        writeFileSync(
          path.join(root, "packages/core/src/audit-broken.d.ts"),
          'declare module "__audit_broken__" {\n  export const broken: numbr;\n}\n',
        );
        const run = runCoverageScript(root);
        expect(run.status).toBe(1);
        expect(run.stderr).toContain("packages/core/src/audit-broken.d.ts");
      }),
    TIMEOUT,
  );

  it(
    "names an unowned source file and nothing else in the copy",
    () =>
      withRepoCopy((root) => {
        writeFileSync(
          path.join(root, "packages/ui/src/orphan-coverage-probe.tsx"),
          "export function Orphan() {\n  return null;\n}\n",
        );
        const run = runCoverageScript(root);
        expect(run.status).toBe(1);
        expect(run.stderr.match(/not covered by any checked typecheck project: .*/g)).toEqual([
          "not covered by any checked typecheck project: packages/ui/src/orphan-coverage-probe.tsx",
        ]);
      }),
    TIMEOUT,
  );

  it(
    "counts the projects a child lists in its typecheck:app script",
    () =>
      withRepoCopy((root) => {
        mkdirSync(path.join(root, "tests/worker"), { recursive: true });
        writeFileSync(path.join(root, "tests/worker/probe.test.ts"), "export const probe = 1;\n");
        expect(runCoverageScript(root).stderr).toContain(
          "not covered by any checked typecheck project: tests/worker/probe.test.ts",
        );

        writeFileSync(
          path.join(root, "tests/worker/tsconfig.json"),
          JSON.stringify({ extends: "../../tsconfig.json", include: ["./**/*"] }),
        );
        writeFileSync(
          path.join(root, "package.json"),
          JSON.stringify({ scripts: { "typecheck:app": "tsc --noEmit -p tests/worker" } }),
        );
        const run = runCoverageScript(root);
        expect(run.stderr).toBe("");
        expect(run.status).toBe(0);
      }),
    TIMEOUT,
  );
});
