import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { actionPinningProblems } from "../../../scripts/check-action-pinning";

const SHA = "fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09";

describe("action pinning", () => {
  it("accepts an action pinned to a full commit SHA, with or without a version comment", () => {
    const pinned = [
      `      - uses: actions/checkout@${SHA} # v5.1.0`,
      `        uses: peter-evans/create-pull-request@${SHA}`,
    ].join("\n");
    expect(actionPinningProblems({ ".github/workflows/test.yml": pinned })).toEqual([]);
  });

  it("fails a mutable tag or branch, naming the file, the line and the fix", () => {
    const mutable = [
      `      - uses: actions/checkout@v5`,
      `        uses: pnpm/action-setup@v4 # not a pin`,
      `      - uses: some/action@main`,
    ].join("\n");
    const problems = actionPinningProblems({ ".github/workflows/test.yml": mutable });
    expect(problems).toEqual([
      ".github/workflows/test.yml:1 uses actions/checkout@v5: pin it to the full commit SHA the tag points at, with the version in a comment (`@<sha> # v5.1.0`).",
      ".github/workflows/test.yml:2 uses pnpm/action-setup@v4: pin it to the full commit SHA the tag points at, with the version in a comment (`@<sha> # v5.1.0`).",
      ".github/workflows/test.yml:3 uses some/action@main: pin it to the full commit SHA the tag points at, with the version in a comment (`@<sha> # v5.1.0`).",
    ]);
  });

  it("fails a SHA that is too short to be a commit", () => {
    expect(
      actionPinningProblems({ "wf.yml": `uses: actions/checkout@${SHA.slice(0, 7)}` }),
    ).toHaveLength(1);
  });

  it("passes on this repository's own workflows", () => {
    const dir = ".github/workflows";
    const files = Object.fromEntries(
      readdirSync(dir)
        .filter((file) => /\.ya?ml$/.test(file))
        .map((file) => [`${dir}/${file}`, readFileSync(`${dir}/${file}`, "utf8")]),
    );
    expect(Object.keys(files).length).toBeGreaterThan(0);
    expect(actionPinningProblems(files)).toEqual([]);
  });
});
