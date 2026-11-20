/**
 * The `server` project shares modules between files (isolate: false), so the
 * setup must fail a file that leaves something behind. This runs the probes
 * in tests/server/checks/isolation-probes through the real setup and reads
 * which files failed and why.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";

type Report = {
  testResults: { name: string; status: string; message: string }[];
};

function runProbes(): Map<string, { status: string; message: string }> {
  const dir = mkdtempSync(join(tmpdir(), "isolation-probes-"));
  try {
    const out = join(dir, "report.json");
    spawnSync(
      "pnpm",
      [
        "exec",
        "vp",
        "test",
        "run",
        "--config",
        "vitest.config.server.ts",
        "--project",
        "server:isolation-probes",
        "--max-workers",
        "1",
        "--reporter",
        "json",
        "--outputFile",
        out,
      ],
      {
        encoding: "utf8",
        timeout: 60_000,
        env: { ...process.env, ISOLATION_PROBES: "1", NODE_ENV: "test" },
      },
    );
    const report = JSON.parse(readFileSync(out, "utf8")) as Report;
    return new Map(
      report.testResults.map((r) => [
        r.name.split("/").at(-1)!,
        { status: r.status, message: r.message },
      ]),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("isolation between server test files", () => {
  const results = runProbes();

  it("passes a file that stubs, spies and installs through vitest and the App root, and closes what it opens", () => {
    expect(results.get("clean.probe.ts")).toMatchObject({ status: "passed" });
  });

  it.each([
    ["env.probe.ts", "process.env.ISOLATION_PROBE_LEAK changed: set it with vi.stubEnv"],
    ["global.probe.ts", "globalThis.isolationProbeLeak added: set it with vi.stubGlobal"],
    ["server.probe.ts", "1 TCP server still listening"],
    ["timer.probe.ts", "1 timer (setTimeout/setInterval) still due"],
  ])("fails %s, naming what it left: %s", (file, leak) => {
    const result = results.get(file);
    expect(result?.status).toBe("failed");
    expect(result?.message).toContain(
      "This file left state behind for the next file in its worker",
    );
    expect(result?.message).toContain(leak);
  });
});
