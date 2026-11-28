import { describe, expect, it } from "vite-plus/test";
import { skillFiles } from "../../../../apps/web/src/server/api/skills/skills.parse";

describe("a skill's stored files", () => {
  it("keeps the readable files when one stored file is malformed", () => {
    expect(
      skillFiles(
        '[{"path":"SKILL.md","content":"# Hi"},{"path":7},{"path":"a.txt","content":"a"}]',
      ),
    ).toEqual([
      { path: "SKILL.md", content: "# Hi" },
      { path: "a.txt", content: "a" },
    ]);
  });
});
