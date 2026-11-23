import { describe, expect, it } from "vite-plus/test";
import { ambiguousAlternation } from "../../../../packages/agent/src/toolkits/attachments-regex";

describe("ambiguous alternation guard", () => {
  it.each([
    ["(a+)+$", true],
    ["(a|aa)+$", true],
    ["(a|a)*b", true],
    ["((a|a)*)*b", true],
    ["(a?)+$", true],
    ["(a?)*", true],
    ["(a|ab)*c", true],
    ["^(a|b)c$", false],
    ["termin\\w+", false],
    ["(foo|bar)baz", false],
    ["(ab|cd)+", false],
    ["^[a-z]+$", false],
  ])("%s -> %s", (pattern, expected) => {
    expect(ambiguousAlternation(pattern)).toBe(expected);
  });
});
