import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

const DURATIONS_FILE = "tests/durations.json";
const SUITES = [
  { name: "server", args: ["exec", "vp", "test", "run", "--config", "vitest.config.server.ts"] },
  { name: "client", args: ["exec", "vp", "test", "run"] },
];

const dir = mkdtempSync(path.join(tmpdir(), "test-durations-"));
const durations = {};
try {
  for (const suite of SUITES) {
    const report = path.join(dir, `${suite.name}.json`);
    console.log(`Running the ${suite.name} suite…`);
    const run = spawnSync(
      "pnpm",
      [...suite.args, "--reporter=dot", "--reporter=json", `--outputFile.json=${report}`],
      { stdio: "inherit", env: { ...process.env, NODE_ENV: "test" } },
    );
    if (run.status !== 0) {
      throw new Error(`The ${suite.name} suite failed; durations not written.`);
    }
    const { testResults } = JSON.parse(readFileSync(report, "utf8"));
    for (const file of testResults) {
      const relative = path.relative(process.cwd(), file.name).split(path.sep).join("/");
      durations[relative] = Math.max(1, Math.round(file.endTime - file.startTime));
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

const sorted = Object.fromEntries(Object.entries(durations).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(DURATIONS_FILE, `${JSON.stringify(sorted, null, 2)}\n`);
console.log(`Wrote ${Object.keys(sorted).length} file durations to ${DURATIONS_FILE}.`);
