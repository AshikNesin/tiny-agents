import { readFileSync } from "node:fs";
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
    const empty = INTACT.replace("trustPolicyExclude:\n  - semver@6.3.1", "trustPolicyExclude: []");
    expect(evaluatePolicy(empty)).toEqual([]);

    expect(evaluatePolicy(INTACT.replace("\ntrustPolicyExclude:\n  - semver@6.3.1", ""))).toEqual(
      [],
    );
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

  it("rejects a weakened exclude written as a flow list, which a block scan skips", () => {
    expect(
      evaluatePolicy(
        INTACT.replace("trustPolicyExclude:\n  - semver@6.3.1", 'trustPolicyExclude: ["semver"]'),
      ),
    ).toEqual([
      { key: "trustPolicyExclude", problem: '"semver" is not an exact name@version pin' },
    ]);
    for (const exclude of [
      'trustPolicyExclude: ["semver@*"]',
      "trustPolicyExclude: ['semver@^6']",
    ]) {
      const out = evaluatePolicy(INTACT.replace("trustPolicyExclude:\n  - semver@6.3.1", exclude));
      expect(out.length).toBeGreaterThan(0);
      for (const failure of out) expect(failure.key).toBe("trustPolicyExclude");
    }
  });

  it("passes a flow list of exact pins", () => {
    const yaml = INTACT.replace(
      "trustPolicyExclude:\n  - semver@6.3.1",
      'trustPolicyExclude: ["semver@6.3.1", "other@2.0.0"]',
    );
    expect(evaluatePolicy(yaml)).toEqual([]);
  });

  it("rejects a version that only starts like a pin: a major, a partial version, a range", () => {
    for (const exclude of [
      "- semver@1",
      "- semver@6.3",
      "- semver@1||2",
      "- semver@>=6",
      "- semver@6.3.1 || 7.0.0",
    ]) {
      expect(evaluatePolicy(INTACT.replace("- semver@6.3.1", exclude))).toEqual([
        {
          key: "trustPolicyExclude",
          problem: expect.stringContaining("is not an exact name@version pin"),
        },
      ]);
    }
  });

  it("accepts an exact pin with a prerelease or build metadata", () => {
    for (const pin of ["- pkg@1.2.3-beta.1", "- pkg@1.2.3+build.5", '- "@scope/pkg@1.2.3"']) {
      expect(evaluatePolicy(INTACT.replace("- semver@6.3.1", pin))).toEqual([]);
    }
  });

  it("fails a file that is not valid YAML, or not a mapping, instead of passing it", () => {
    const broken = INTACT.replace("  - semver@6.3.1", "  - semver@6.3.1\n  -  [unbalanced");
    const [failure] = evaluatePolicy(broken);
    expect(failure.key).toBe("pnpm-workspace.yaml");
    expect(failure.problem).toMatch(/^is not valid YAML: /);

    expect(evaluatePolicy("- just\n- a list\n")).toEqual([
      { key: "pnpm-workspace.yaml", problem: "is not a YAML mapping" },
    ]);
  });

  it("passes on this repository's own pnpm-workspace.yaml", () => {
    expect(evaluatePolicy(readFileSync("pnpm-workspace.yaml", "utf8"))).toEqual([]);
  });
});
