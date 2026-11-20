import { describe, expect, it } from "vite-plus/test";
import { markdownToPlainText } from "@/lib/plain-text";

describe("markdownToPlainText", () => {
  it("drops emphasis, code and link syntax", () => {
    expect(
      markdownToPlainText(
        'Echo: **Routine "Morning digest":** _see_ `npm test` and [the docs](https://x.dev) ~~old~~',
      ),
    ).toBe('Echo: Routine "Morning digest": see npm test and the docs old');
  });

  it("flattens headings, quotes, lists and code fences onto one line", () => {
    expect(
      markdownToPlainText("## Summary\n> quoted\n- first\n2. second\n\n```ts\nconst a = 1;\n```"),
    ).toBe("Summary quoted first second const a = 1;");
  });

  it("leaves snake_case and arithmetic alone", () => {
    expect(markdownToPlainText("set max_retry_count to 2 * 3 * 4")).toBe(
      "set max_retry_count to 2 * 3 * 4",
    );
  });
});
