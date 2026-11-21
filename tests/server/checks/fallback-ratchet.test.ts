import { describe, expect, it } from "vite-plus/test";
import { fallbackRatchetProblems } from "../../../scripts/check-fallback-ratchet";

describe("silent fallback ratchet", () => {
  it("passes a baseline that kept or cut its counts", () => {
    expect(fallbackRatchetProblems({ "a.ts": 1 }, { "a.ts": 2, "b.ts": 1 })).toEqual([]);
  });

  it("fails a count raised against the base branch", () => {
    expect(fallbackRatchetProblems({ "a.ts": 3 }, { "a.ts": 2 })).toEqual([
      "a.ts: the ratchet grew from 2 to 3. It only shrinks.",
    ]);
  });

  it("fails a new file given an allowance", () => {
    expect(fallbackRatchetProblems({ "a.ts": 2, "new.ts": 1 }, { "a.ts": 2 })).toEqual([
      "scripts/lint/silent-fallback-baseline.json gives new paths 1 but frees only 0. A rename may carry its count; a new file starts at 0.",
    ]);
  });
});
