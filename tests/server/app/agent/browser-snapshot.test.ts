/**
 * What the model reads of a page: Playwright's `ai` snapshot made compact,
 * and long reads cut into windows the model can read on through. The input
 * below is a trimmed copy of a real snapshot of news.ycombinator.com.
 */
import { describe, expect, it } from "vite-plus/test";
import {
  compactSnapshot,
  filterSnapshot,
  pageWindow,
  snapshotDiff,
  tidyText,
} from "../../../../packages/sandbox/src/browser-snapshot";

const HACKER_NEWS = `- table [ref=e30]:
  - rowgroup [ref=e31]:
    - row [ref=e32]:
      - cell "1." [ref=e33]
      - cell [ref=e34]:
        - link "upvote" [ref=e36] [cursor=pointer]:
          - /url: vote?id=50535230&how=up&goto=news
      - cell [ref=e38]:
        - generic [ref=e39]:
          - link "GPT-6.2 Astra and Sol" [ref=e40] [cursor=pointer]:
            - /url: https://openai.com/index/introducing-gpt-6-2-astra-sol/
          - generic [ref=e41]:
            - text: (
            - link "openai.com" [ref=e42] [cursor=pointer]:
              - /url: from?site=openai.com
            - text: )
    - row [ref=e43]:
      - cell [ref=e44]
      - cell [ref=e45]:
        - generic [ref=e46]:
          - text: 731 points by
          - generic [ref=e48] [cursor=pointer]: jasondavies`;

describe("compact snapshot", () => {
  it("unwraps layout wrappers, keeps refs only where they can be used, and puts URLs on the link's line", () => {
    expect(compactSnapshot(HACKER_NEWS)).toBe(
      [
        "- table [ref=e30]:",
        "  - row:",
        '    - cell "1."',
        '    - link "upvote" [ref=e36] [url=vote?id=50535230&how=up&goto=news]',
        '    - link "GPT-6.2 Astra and Sol" [ref=e40] [url=https://openai.com/index/introducing-gpt-6-2-astra-sol/]',
        "    - text: (",
        '    - link "openai.com" [ref=e42] [url=from?site=openai.com]',
        "    - text: )",
        "  - row:",
        "    - text: 731 points by",
        "    - generic [ref=e48]: jasondavies",
      ].join("\n"),
    );
  });

  it("leaves out focus, which moves with every action", () => {
    expect(compactSnapshot('- textbox "Query" [active] [ref=e4]: cables')).toBe(
      '- textbox "Query" [ref=e4]: cables',
    );
  });

  it("keeps a named wrapper and a link that has children besides its URL", () => {
    const tree = [
      '- group "Shipping" [ref=e2]:',
      '  - radio "Express" [ref=e3]',
      '- link "Issues (44)" [ref=e90] [cursor=pointer]:',
      "  - /url: /microsoft/playwright/issues",
      "  - generic [ref=e95]: Issues",
    ].join("\n");
    expect(compactSnapshot(tree)).toBe(
      [
        '- group "Shipping":',
        '  - radio "Express" [ref=e3]',
        '- link "Issues (44)" [ref=e90] [url=/microsoft/playwright/issues]:',
        "  - generic: Issues",
      ].join("\n"),
    );
  });

  it("cuts a tracking URL past 200 characters", () => {
    const long = `https://example.com/?${"q".repeat(300)}`;
    const out = compactSnapshot(`- link "Ad" [ref=e5]:\n  - /url: ${long}`);
    expect(out).toBe(`- link "Ad" [ref=e5] [url=${long.slice(0, 200)}…]`);
  });
});

describe("snapshot query", () => {
  it("keeps the lines that contain every word, ignoring case", () => {
    const tree = '- button "Add to cart" [ref=e1]\n- link "Cart (2)" [ref=e2]\n- text: Add a note';
    expect(filterSnapshot(tree, "add CART")).toEqual({
      text: '- button "Add to cart" [ref=e1]',
      matches: 1,
    });
  });
});

describe("page window", () => {
  it("returns a short read as it is", () => {
    expect(pageWindow("short", 0, 100, "")).toEqual({ text: "short", nextOffset: null });
  });

  it("ends a window at a line break and says where to read on", () => {
    const text = "aaaa\nbbbb\ncccc\ndddd"; // 19 characters
    const first = pageWindow(text, 0, 12, "");
    expect(first).toEqual({
      text: "aaaa\nbbbb\n…(9 more characters. Call again with offset 10 to read on)",
      nextOffset: 10,
    });
    expect(pageWindow(text, 10, 12, "")).toEqual({
      text: "…(from character 10 of 19)\ncccc\ndddd",
      nextOffset: null,
    });
  });
});

describe("tidy text", () => {
  it("squeezes blank runs and trailing spaces", () => {
    expect(tidyText("Title  \n\n\n\nBody\t\n")).toBe("Title\n\nBody");
  });
});

describe("snapshot diff", () => {
  it("shows the new lines under the unchanged line they belong to, and counts what went", () => {
    const before = ["- list [ref=e1]:", '  - link "One" [ref=e2]', '- button "More" [ref=e9]'].join(
      "\n",
    );
    const after = [
      "- list [ref=e1]:",
      '  - link "One" [ref=e2]',
      '  - link "Two" [ref=e3]',
      '  - link "Three" [ref=e4]',
      '- button "More" [ref=e9] [disabled]',
    ].join("\n");
    expect(snapshotDiff(before, after)).toEqual({
      added: 3,
      removed: 1,
      text: [
        "  - list [ref=e1]:",
        '+   - link "Two" [ref=e3]',
        '+   - link "Three" [ref=e4]',
        '+ - button "More" [ref=e9] [disabled]',
      ].join("\n"),
    });
  });

  it("counts a repeated line once per copy", () => {
    expect(snapshotDiff('- text: "|"', '- text: "|"\n- text: "|"')).toEqual({
      added: 1,
      removed: 0,
      text: '+ - text: "|"',
    });
  });
});
