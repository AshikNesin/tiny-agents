import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";

const SCRIPT = path.join(process.cwd(), "scripts", "check-merge-main.mjs");
const JOURNAL = "apps/web/drizzle/meta/_journal.json";
const VERSIONS = "mobile/android/version.properties";
const MOBILE_PACKAGE = "mobile/package.json";
const ACTIVITY = "mobile/android/app/src/main/java/Main.kt";

const GIT_IDENTITY = [
  ["-c", "user.name=Dev"],
  ["-c", "user.email=dev@example.com"],
  ["-c", "commit.gpgsign=false"],
  ["-c", "core.hooksPath=/dev/null"],
].flat();

type Files = Record<string, string>;

const journal = (...tags: string[]) =>
  `${JSON.stringify({ version: "7", entries: tags.map((tag, idx) => ({ idx, tag })) }, null, 2)}\n`;
const versions = (name: string, code: number) => `VERSION_NAME=${name}\nVERSION_CODE=${code}\n`;
const mobilePackage = (version: string) => `${JSON.stringify({ name: "mobile", version })}\n`;

const BASE: Files = {
  "README.md": "# tiny-agents\n\nIntro.\n\nUsage.\n",
  [JOURNAL]: journal("0000_init", "0023_notes"),
  [VERSIONS]: versions("0.9.0", 16),
  [MOBILE_PACKAGE]: mobilePackage("0.9.0"),
  [ACTIVITY]: "class Main\n",
};

function write(dir: string, files: Files) {
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), body);
  }
}

function runGate({ main = {}, branch }: { main?: Files; branch: Files }) {
  const dir = mkdtempSync(path.join(tmpdir(), "merge-main-"));
  const git = (...args: string[]) =>
    execFileSync("git", [...GIT_IDENTITY, ...args], { cwd: dir, encoding: "utf8" }).trim();
  try {
    write(dir, BASE);
    git("init", "-q", "-b", "main");
    git("add", ".");
    git("commit", "-q", "-m", "base");
    git("checkout", "-q", "-b", "branch");
    write(dir, branch);
    git("add", "-A");
    git("commit", "-q", "-m", "branch");
    git("checkout", "-q", "main");
    if (Object.keys(main).length > 0) {
      write(dir, main);
      git("add", "-A");
      git("commit", "-q", "-m", "main moves on");
    }
    git("update-ref", "refs/remotes/origin/main", "main");
    git("checkout", "-q", "branch");
    const run = spawnSync("node", [SCRIPT, "--root", dir, "--base", "origin/main"], {
      encoding: "utf8",
    });
    return { status: run.status, out: `${run.stdout}${run.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("check-merge-main", () => {
  it("fails two branches that took the same migration number, naming the file and the fix", () => {
    const { status, out } = runGate({
      main: { [JOURNAL]: journal("0000_init", "0023_notes", "0024_tags") },
      branch: { [JOURNAL]: journal("0000_init", "0023_notes", "0024_pins") },
    });
    expect(status).toBe(1);
    expect(out).toContain(`  ${JOURNAL}\n`);
    expect(out).toContain("git fetch origin main && git merge origin/main");
    expect(out).toContain("pnpm db:generate");
  });

  it("passes a branch that merges cleanly with a main that moved on", () => {
    const { status, out } = runGate({
      main: { "README.md": "# tiny-agents\n\nIntro, longer.\n\nUsage.\n" },
      branch: { "README.md": "# tiny-agents\n\nIntro.\n\nUsage, longer.\n" },
    });
    expect(out).not.toContain("conflict");
    expect(status).toBe(0);
  });

  it("fails an Android change that leaves VERSION_CODE where main has it", () => {
    const { status, out } = runGate({ branch: { [ACTIVITY]: "class Main {}\n" } });
    expect(status).toBe(1);
    expect(out).toContain("VERSION_CODE is 16, the same as origin/main's 16. Set it to 17");
  });

  it("passes an Android change that bumps VERSION_CODE and VERSION_NAME together", () => {
    const { status } = runGate({
      branch: {
        [ACTIVITY]: "class Main {}\n",
        [VERSIONS]: versions("0.9.1", 17),
        [MOBILE_PACKAGE]: mobilePackage("0.9.1"),
      },
    });
    expect(status).toBe(0);
  });

  it("fails a bump to the VERSION_CODE main already took, which merges without a conflict", () => {
    const bump = {
      [VERSIONS]: versions("0.9.1", 17),
      [MOBILE_PACKAGE]: mobilePackage("0.9.1"),
    };
    const { status, out } = runGate({
      main: { ...bump, "mobile/android/app/src/main/java/Other.kt": "class Other\n" },
      branch: { ...bump, [ACTIVITY]: "class Main {}\n" },
    });
    expect(out).not.toContain("conflict");
    expect(status).toBe(1);
    expect(out).toContain("VERSION_CODE is 17, the same as origin/main's 17. Set it to 18");
  });

  it("fails a mobile/package.json version that differs from VERSION_NAME", () => {
    const { status, out } = runGate({ branch: { [MOBILE_PACKAGE]: mobilePackage("0.10.0") } });
    expect(status).toBe(1);
    expect(out).toContain(
      `${MOBILE_PACKAGE} version is 0.10.0 but ${VERSIONS} VERSION_NAME is 0.9.0`,
    );
  });
});
