import { describe, expect, it } from "vite-plus/test";
import { ratchetProblems } from "../../../scripts/check-comment-ratchet";
import { countComments, inScope } from "../../../scripts/lint/comments.mjs";

describe("comment ratchet", () => {
  it("passes a file at its allowance", () => {
    expect(ratchetProblems({ "a.ts": 2 }, { "a.ts": 2 }, { "a.ts": 2 })).toEqual([]);
  });

  it("fails a file with more comments than the ratchet allows", () => {
    expect(ratchetProblems({ "a.ts": 3, "b.ts": 1 }, { "a.ts": 2 }, null)).toEqual([
      "a.ts: 3 comments, the ratchet allows 2. R16 bans new comments (ADR 0028): name the why in code, or record a decision in an ADR.",
      "b.ts: 1 comments, the ratchet allows 0. R16 bans new comments (ADR 0028): name the why in code, or record a decision in an ADR.",
    ]);
  });

  it("fails an allowance left above the file's count, so a deletion is locked in", () => {
    expect(ratchetProblems({ "a.ts": 1 }, { "a.ts": 2, "gone.ts": 1 }, null)).toEqual([
      "a.ts: the ratchet allows 2 comments but the file has 1. Run 'pnpm comments:ratchet' to lock in the cut.",
      "gone.ts: the ratchet allows 1 comments but the file has 0. Run 'pnpm comments:ratchet' to lock in the cut.",
    ]);
  });

  it("fails an allowance that grew against the base branch", () => {
    expect(ratchetProblems({ "a.ts": 3 }, { "a.ts": 3 }, { "a.ts": 2 })).toEqual([
      "a.ts: the ratchet grew from 2 to 3. It only shrinks.",
    ]);
  });

  it("lets a rename carry its count, but not a new file", () => {
    expect(ratchetProblems({ "new.ts": 2 }, { "new.ts": 2 }, { "old.ts": 2 })).toEqual([]);
    expect(
      ratchetProblems({ "a.ts": 1, "b.ts": 1 }, { "a.ts": 1, "b.ts": 1 }, { "a.ts": 1 }),
    ).toEqual([
      "scripts/lint/comment-baseline.json gives new paths 1 but frees only 0. A rename may carry its count; a new file starts at 0.",
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
