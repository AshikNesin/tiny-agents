import { describe, expect, it } from "vite-plus/test";
import { commentProblems } from "../../../scripts/check-comments";
import { countComments, inScope } from "../../../scripts/lint/comments.mjs";

describe("comment check", () => {
  it("passes when no file in scope has a comment", () => {
    expect(commentProblems({})).toEqual([]);
  });

  it("names each file that has a comment, with the fix", () => {
    expect(commentProblems({ "mobile/a.kt": 2 })).toEqual([
      "mobile/a.kt: 2 comments. Code carries no comments (ADR 0028): say it in a name, a type or a test, and record a decision in docs/adr/.",
    ]);
  });

  it("counts Kotlin and CSS comments, skipping strings and directives", async () => {
    const kotlin =
      '// one\nval url = "https://example.com" /* two */\n@Suppress("x") /* outer /* nested */ still */\n// ktlint-disable\nval raw = """// not a comment"""\nval host = "Sign in to ${url.substringAfter("://")}"\n';
    expect(await countComments("Main.kt", kotlin)).toBe(3);
    expect(
      await countComments(
        "a.css",
        'a { content: "/* no */"; } /* yes */\n/* stylelint-disable */\n',
      ),
    ).toBe(1);
  });

  it("does not count a hashbang", async () => {
    expect(await countComments("run.mjs", "#!/usr/bin/env node\nexport const a = 1;\n")).toBe(0);
  });

  it("leaves vendored and generated paths out of scope", () => {
    expect(inScope("apps/web/src/server/app.ts")).toBe(true);
    expect(inScope("mobile/android/app/src/main/java/Main.kt")).toBe(true);
    expect(inScope(".agents/skills/stageshow/kit/parts.ts")).toBe(false);
    expect(inScope("site/demos/kit/motion/a.css")).toBe(false);
    expect(inScope("mobile/android/kit/src/main/java/Kit.kt")).toBe(false);
    expect(inScope("apps/web/drizzle/meta/x.ts")).toBe(false);
    expect(inScope("README.md")).toBe(false);
  });
});
