/**
 * Characterization of behavior-register row S9: a bot can overwrite any skill
 * assigned to it, including a GitHub import shared with other bots.
 * Preserve: this pins today's behavior, quirk included; change it only with a
 * signed-off register row.
 *
 * `skillStore.save` (skills.store.ts) updates the description and body of any
 * skill linked to the calling bot, whatever its `source`. A GitHub import
 * (`source: "url"`) assigned to two bots is rewritten in place for both.
 */
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { skillStore } from "../../../apps/web/src/server/api/skills/skills.store";
import { botSkills, db, skills } from "../../../apps/web/src/server/db";
import { resetAppTables, seedBot } from "../fixtures";

const GITHUB_URL = "https://github.com/acme/skills/tree/main/deploy";

describe("S9: a bot overwrites a shared GitHub-imported skill", () => {
  beforeEach(resetAppTables);
  afterEach(resetAppTables);

  it("rewrites the shared row in place, so every bot assigned it sees the new body", async () => {
    const writer = await seedBot({ name: "Writer", conversationId: "9101" });
    const other = await seedBot({ name: "Other", conversationId: "9102" });
    const [imported] = await db
      .insert(skills)
      .values({
        name: "deploy",
        description: "Deploy the app",
        body: "Upstream instructions",
        files: JSON.stringify([{ path: "notes.md", content: "kept" }]),
        source: "url",
        sourceUrl: GITHUB_URL,
      })
      .returning();
    await db.insert(botSkills).values([
      { botId: writer.id, skillId: imported!.id },
      { botId: other.id, skillId: imported!.id },
    ]);

    const result = await skillStore.save(9101, {
      name: "deploy",
      description: "Rewritten by Writer",
      body: "Writer's own instructions",
    });

    // An update, not a refusal and not a copy.
    expect(result).toEqual({ created: false });
    const rows = await db.select().from(skills);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: imported!.id,
      description: "Rewritten by Writer",
      body: "Writer's own instructions",
      // Still marked as the GitHub import, bundled files untouched.
      source: "url",
      sourceUrl: GITHUB_URL,
      files: JSON.stringify([{ path: "notes.md", content: "kept" }]),
    });
    // The other bot reads the overwritten body through its own conversation.
    expect(await skillStore.get(9102, "deploy")).toMatchObject({
      description: "Rewritten by Writer",
      body: "Writer's own instructions",
      files: ["notes.md"],
    });
    // Both links remain.
    expect(
      await db.select().from(botSkills).where(eq(botSkills.skillId, imported!.id)),
    ).toHaveLength(2);
  });
});
