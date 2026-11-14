import { describe, expect, it } from "vite-plus/test";
import { emDashProblems } from "../../../scripts/check-no-em-dash";

const DASH = String.fromCodePoint(0x2014);

describe("check:em-dash", () => {
  it("passes text without an em dash, hyphens and en dashes included", () => {
    expect(emDashProblems("a.md", "one - two\nthree: four\n5–6")).toEqual([]);
  });

  it("names the file and line of a typed em dash", () => {
    expect(emDashProblems("a.ts", `ok\nfoo ${DASH} bar`)).toEqual(["a.ts:2: foo " + DASH + " bar"]);
  });

  it("catches escaped forms", () => {
    // Built from pieces so this file passes the check it tests.
    const code = "2014";
    const escaped = [`\\u${code}`, `\\u{${code}}`, `&${"m"}dash;`, `&#${8212};`, `&#x${code};`];
    for (const form of escaped) {
      expect(emDashProblems("a.html", `x ${form} y`)).toHaveLength(1);
    }
  });

  it("skips binary files", () => {
    expect(emDashProblems("a.mp4", `\0${DASH}`)).toEqual([]);
  });
});
