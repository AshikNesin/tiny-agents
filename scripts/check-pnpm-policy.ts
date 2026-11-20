#!/usr/bin/env tsx
import { readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

const EXPECTED = {
  minimumReleaseAge: "1440",
  trustPolicy: "no-downgrade",
} as const;

export interface Failure {
  key: string;
  problem: string;
}

const EXACT_PIN = /^[\w@/.-]+@\d+[^\s,]*$/;

export function evaluatePolicy(yaml: string): Failure[] {
  const failures: Failure[] = [];
  const lines = yaml.split(/\r?\n/);

  const entries = new Map<string, string>(
    lines
      .map((line) => /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => [m[1], m[2]] as const),
  );

  for (const [key, expected] of Object.entries(EXPECTED)) {
    const actual = entries.get(key) ?? null;
    if (actual === null) {
      failures.push({ key, problem: "missing" });
    } else if (actual.replace(/["']/g, "") !== expected) {
      failures.push({ key, problem: `expected "${expected}", found "${actual}"` });
    }
  }

  const excludeStart = lines.findIndex((line) => line.startsWith("trustPolicyExclude:"));
  if (excludeStart !== -1) {
    for (const line of lines.slice(excludeStart + 1)) {
      const item = /^\s+-\s*(.+)$/.exec(line)?.[1];
      if (!item) break;
      const pin = item.replace(/["']/g, "").trim();
      if (!EXACT_PIN.test(pin)) {
        failures.push({
          key: "trustPolicyExclude",
          problem: `"${pin}" is not an exact name@version pin`,
        });
      }
    }
  }

  return failures;
}

if (process.argv[1]?.endsWith("check-pnpm-policy.ts")) {
  const ROOT = new URL("..", import.meta.url).pathname;
  const failures = evaluatePolicy(readFileSync(join(ROOT, "pnpm-workspace.yaml"), "utf8"));

  for (const { key, problem } of failures) {
    console.error(`✗ pnpm-workspace.yaml: ${key} ${problem}`);
  }
  if (failures.length > 0) {
    console.error(
      "\nThe install-hardening policy is load-bearing (see the comment block in pnpm-workspace.yaml). " +
        "Restore the guarded keys, or use exact name@version excludes.",
    );
    process.exit(1);
  }
  console.log("✓ pnpm policy intact (minimumReleaseAge, trustPolicy, exact excludes)");
}
