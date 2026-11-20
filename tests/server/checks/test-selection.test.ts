import { describe, expect, it } from "vite-plus/test";
import { selection } from "../../../scripts/test-selection.mjs";

const BASE = "0123456789abcdef0123456789abcdef01234567";

describe("test selection", () => {
  it("runs everything outside pull requests: the merge queue, pushes, manual runs", () => {
    for (const event of ["merge_group", "push", "workflow_dispatch"]) {
      expect(selection({ event, mergeBase: "", changedFiles: [] }).args).toEqual([]);
    }
  });

  it("selects the tests a pull request's diff can reach", () => {
    expect(
      selection({
        event: "pull_request",
        mergeBase: BASE,
        changedFiles: ["apps/web/src/server/api/ws/upgrade.ts", "docs/guides/testing.md"],
      }),
    ).toEqual({
      args: [`--changed=${BASE}`, "--passWithNoTests"],
      reason:
        "Selected: test files the 2 changed file(s) since 0123456 can reach. The merge queue runs everything.",
    });
  });

  it.each([
    "tests/server/setup.ts",
    "tests/client/setup.ts",
    "tests/test-clock.ts",
    "vitest.config.server.ts",
    "vite.config.ts",
    "apps/web/drizzle/0027_new.sql",
    "apps/web/src/server/db/schema.ts",
    "packages/core/src/database/schema.ts",
    "package.json",
    "packages/agent/package.json",
    "pnpm-lock.yaml",
    "tests/server/fixtures/db.ts",
    ".github/workflows/test.yml",
  ])("runs everything on a pull request that changes %s", (file) => {
    const { args, reason } = selection({
      event: "pull_request",
      mergeBase: BASE,
      changedFiles: ["apps/web/src/client/App.tsx", file],
    });
    expect(args).toEqual([]);
    expect(reason).toBe(
      `Full run: ${file} changed, and the import graph cannot see what it affects.`,
    );
  });
});
