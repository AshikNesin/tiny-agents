#!/usr/bin/env tsx
import { readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { load } from "js-yaml";

const EXPECTED = {
  minimumReleaseAge: "1440",
  trustPolicy: "no-downgrade",
} as const;

export interface Failure {
  key: string;
  problem: string;
}

const EXACT_PIN = /^(?:@[\w.-]+\/)?[\w.-]+@\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/;

export function evaluatePolicy(yaml: string): Failure[] {
  const failures: Failure[] = [];

  let parsed: unknown;
  try {
    parsed = load(yaml);
  } catch (error) {
    return [
      { key: "pnpm-workspace.yaml", problem: `is not valid YAML: ${String(error).split("\n")[0]}` },
    ];
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return [{ key: "pnpm-workspace.yaml", problem: "is not a YAML mapping" }];
  }
  const entries = parsed as Record<string, unknown>;

  for (const [key, expected] of Object.entries(EXPECTED)) {
    const actual = entries[key];
    if (actual === undefined || actual === null) {
      failures.push({ key, problem: "missing" });
    } else if (String(actual) !== expected) {
      failures.push({ key, problem: `expected "${expected}", found "${String(actual)}"` });
    }
  }

  const excludes = entries.trustPolicyExclude;
  if (excludes !== undefined && excludes !== null) {
    if (!Array.isArray(excludes) || excludes.some((item) => typeof item !== "string")) {
      failures.push({
        key: "trustPolicyExclude",
        problem: "must be a list of name@version strings",
      });
    } else {
      for (const pin of excludes) {
        if (!EXACT_PIN.test(pin)) {
          failures.push({
            key: "trustPolicyExclude",
            problem: `"${pin}" is not an exact name@version pin`,
          });
        }
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
