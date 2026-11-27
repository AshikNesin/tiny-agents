import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";

const DRIVERS = "packages/code/src/drivers";
const TESTS = "tests/server/code";
const CHECKS = ["capabilityProblems", "threadEventProblems", "describeTurnOutcomeRule"];

const drivers = readdirSync(DRIVERS, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

describe("every Code driver runs the shared conformance checks", () => {
  it("finds the drivers", () => {
    expect(drivers.length).toBeGreaterThanOrEqual(3);
  });

  it.each(drivers)("%s", (driver) => {
    const file = path.join(TESTS, driver, "driver.test.ts");
    expect(
      existsSync(file),
      `${DRIVERS}/${driver} has no ${file}. Copy the shape of ${TESTS}/pi/driver.test.ts.`,
    ).toBe(true);
    const source = readFileSync(file, "utf8");
    const missing = CHECKS.filter((check) => !source.includes(`${check}(`));
    expect(
      missing,
      `${file} must call each of these from packages/code/src/testing.ts and ${TESTS}/turn-outcome-conformance.ts, so a rule every harness follows is checked on this one too.`,
    ).toEqual([]);
  });
});
