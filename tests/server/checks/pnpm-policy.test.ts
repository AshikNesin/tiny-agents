import { describe, expect, it } from "vite-plus/test";
import { evaluatePolicy } from "../../../scripts/check-pnpm-policy";

const INTACT = [
  "minimumReleaseAge: 1440",
  "trustPolicy: no-downgrade",
  "packages:",
  '  - "."',
  "trustPolicyExclude:",
  "  - semver@6.3.1",
].join("\n");

describe("pnpm policy guard", () => {
  it("passes the intact policy", () => {
    expect(evaluatePolicy(INTACT)).toEqual([]);
  });

  it("passes an empty exclude list", () => {
    expect(evaluatePolicy(`${INTACT}\ntrustPolicyExclude: []\n`)).toEqual([]);
  });

  it("rejects a weakened trustPolicy value", () => {
    const out = evaluatePolicy(INTACT.replace("trustPolicy: no-downgrade", "trustPolicy: ignore"));
    expect(out).toEqual([
      { key: "trustPolicy", problem: 'expected "no-downgrade", found "ignore"' },
    ]);
  });

  it("rejects a missing release-age gate", () => {
    const out = evaluatePolicy(INTACT.replace("minimumReleaseAge: 1440\n", ""));
    expect(out).toEqual([{ key: "minimumReleaseAge", problem: "missing" }]);
  });

  it("rejects wildcard excludes: bare name, @*, and range", () => {
    for (const exclude of ["- semver", '- "semver@*"', "- semver@^6"]) {
      const out = evaluatePolicy(INTACT.replace("- semver@6.3.1", exclude));
      expect(out).toHaveLength(1);
      expect(out[0].key).toBe("trustPolicyExclude");
    }
  });

  it("rejects version ranges an exact pin must not cover", () => {
    for (const exclude of [
      "- semver@6.*",
      "- semver@6||7",
      "- semver@>=6",
      "- semver@~6.3.0",
      "- semver@6",
      '- "semver@6.x"',
    ]) {
      const out = evaluatePolicy(INTACT.replace("- semver@6.3.1", exclude));
      expect(out, exclude).toHaveLength(1);
      expect(out[0].key).toBe("trustPolicyExclude");
    }
  });

  it("accepts a scoped exact pin with a prerelease", () => {
    expect(evaluatePolicy(INTACT.replace("- semver@6.3.1", '- "@pierre/theme@2.0.0"'))).toEqual([]);
    expect(evaluatePolicy(INTACT.replace("- semver@6.3.1", "- pkg@1.2.3-beta.1"))).toEqual([]);
  });

  it("validates every exclusion past interleaved comments", () => {
    const commented = [
      ...INTACT.split("\n"),
      "  # a reviewed exclusion note",
      "  - semver@6.3.1",
      "  # another note",
      "  - semver@6.*",
    ].join("\n");
    const out = evaluatePolicy(commented);
    expect(out).toEqual([
      {
        key: "trustPolicyExclude",
        problem: '"semver@6.*" is not an exact name@version pin',
      },
    ]);
  });

  it("ignores the policy description in comments", () => {
    const commented = `# trustPolicy: no-downdown: docs mention values all the time\n${INTACT}`;
    expect(evaluatePolicy(commented)).toEqual([]);
  });
});
