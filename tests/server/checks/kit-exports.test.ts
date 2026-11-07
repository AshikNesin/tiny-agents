import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { withRepoCopy } from "./repo-copy";

/**
 * Kit export guard (scripts/check-kit-exports.ts).
 *
 * The script keeps the explicit exports maps of @groot/ui and @groot/jobs in
 * agreement with their source files and with the imports of the compiled
 * consumer fixture. A new module, a removed subpath, or a fixture that stops
 * exercising a subpath must fail a check, because the fixture is what forces
 * the removal deliberation recorded in AGENTS.md.
 */

const repoRoot = process.cwd();
const SCRIPT = path.join("scripts", "check-kit-exports.ts");
const TIMEOUT = 60_000;
const GIT_IDENTITY = [
  ["-c", "user.name=Dev"],
  ["-c", "user.email=dev@example.com"],
  ["-c", "commit.gpgsign=false"],
  ["-c", "core.hooksPath=/dev/null"],
].flat();

function runGuard(
  checkedRepo = repoRoot,
  args: string[] = [],
): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync("pnpm", ["exec", "tsx", path.join(checkedRepo, SCRIPT), ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: TIMEOUT,
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

describe("kit exports guard", () => {
  it(
    "agrees with the fixture at head",
    () => {
      const run = runGuard();
      expect(run.stderr).toBe("");
      expect(run.status).toBe(0);
      expect(run.stdout).toContain("kit exports and consumer fixture agree");
    },
    TIMEOUT,
  );

  it(
    "fails when an exports entry loses its fixture import",
    () =>
      withRepoCopy((root) => {
        const fixture = path.join(root, "tests/kit-consumers/consumer.tsx");
        const original = fs.readFileSync(fixture, "utf8");
        // Drop one barrel import so the "." entry stops being exercised.
        const withoutBarrelImport = original.replace(
          /import \{ Button as ButtonFromBarrel[^\n]*\n/,
          "",
        );
        expect(withoutBarrelImport).not.toBe(original);
        fs.writeFileSync(fixture, withoutBarrelImport);
        const run = runGuard(root);
        expect(run.status).toBe(1);
        expect(run.stderr).toContain("public but the kit fixture never imports it");
      }),
    TIMEOUT,
  );

  it(
    "fails when a source module has no exports entry",
    () =>
      withRepoCopy((root) => {
        fs.writeFileSync(
          path.join(root, "packages/ui/src/kit-guard-probe.tsx"),
          "export function KitGuardProbe() {\n  return null;\n}\n",
        );
        const run = runGuard(root);
        expect(run.status).toBe(1);
        expect(run.stderr).toContain("kit-guard-probe");
      }),
    TIMEOUT,
  );

  it(
    "fails when a named export on the merge base is removed, unless the removal is approved",
    () =>
      withRepoCopy((root) => {
        const git = (...args: string[]) =>
          execFileSync("git", [...GIT_IDENTITY, ...args], { cwd: root, encoding: "utf8" });
        fs.writeFileSync(path.join(root, ".gitignore"), "node_modules\n");
        git("init", "-q");
        git("add", "-A");
        git("commit", "-q", "-m", "main");
        const breadcrumb = path.join(root, "packages/ui/src/breadcrumb.tsx");
        const original = fs.readFileSync(breadcrumb, "utf8");
        const removed = original.replace(/^ {2}BreadcrumbEllipsis,\n/m, "");
        expect(removed).not.toBe(original);
        fs.writeFileSync(breadcrumb, removed);

        const run = runGuard(root, ["--base", "HEAD"]);
        expect(run.status).toBe(1);
        expect(run.stderr).toContain('@groot/ui/breadcrumb: export "BreadcrumbEllipsis"');
        expect(run.stderr).toContain("deprecate it in a minor release");

        fs.writeFileSync(
          path.join(root, "scripts/kit-export-removals.json"),
          JSON.stringify([{ package: "@groot/ui", name: "BreadcrumbEllipsis", reason: "test" }]),
        );
        expect(runGuard(root, ["--base", "HEAD"]).status).toBe(0);
      }),
    TIMEOUT,
  );

  it(
    "fails when the exports map reintroduces a wildcard",
    () =>
      withRepoCopy((root) => {
        const manifest = path.join(root, "packages/jobs/package.json");
        const pkg = JSON.parse(fs.readFileSync(manifest, "utf8"));
        pkg.exports["./*"] = "./src/*";
        fs.writeFileSync(manifest, JSON.stringify(pkg, null, 2) + "\n");
        const run = runGuard(root);
        expect(run.status).toBe(1);
        expect(run.stderr).toContain('wildcard export "./*"');
      }),
    TIMEOUT,
  );
});
