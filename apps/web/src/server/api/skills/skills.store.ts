/**
 * SkillStore adapter: the agent's `skills` capability reads the skills
 * assigned to the bot behind a conversation from app.db. Dependency direction
 * stays one-way — `@tiny-agents/agent` defines the port, apps/web implements it.
 */
import { asc, eq } from "drizzle-orm";
import { botSkills, bots, db, skills } from "../../db";
import type { SkillStore } from "@tiny-agents/agent";
import { conversationOwner } from "../bots/bots.owner";
import type { SkillFile } from "./skills.parse";

function files(raw: string): SkillFile[] {
  try {
    const parsed = JSON.parse(raw) as SkillFile[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function assigned(conversationId: number) {
  const owner = await conversationOwner(conversationId);
  if (!owner) return { botId: undefined, skills: [] };
  const bot = await db.query.bots.findFirst({
    where: eq(bots.id, owner.botId),
    columns: { id: true },
  });
  if (!bot) return { botId: undefined, skills: [] };
  const links = await db
    .select({ skill: skills })
    .from(botSkills)
    .innerJoin(skills, eq(botSkills.skillId, skills.id))
    .where(eq(botSkills.botId, bot.id))
    .orderBy(asc(skills.name));
  return { botId: bot.id, skills: links.map((link) => link.skill) };
}

export const skillStore: SkillStore = {
  async list(conversationId) {
    const { skills } = await assigned(conversationId);
    return skills.map(({ name, description }) => ({ name, description }));
  },

  async get(conversationId, name) {
    const skill = (await assigned(conversationId)).skills.find((s) => s.name === name);
    if (!skill) return undefined;
    return {
      name: skill.name,
      description: skill.description,
      body: skill.body,
      files: files(skill.files).map((file) => file.path),
    };
  },

  async readFile(conversationId, name, path) {
    const skill = (await assigned(conversationId)).skills.find((s) => s.name === name);
    return skill ? files(skill.files).find((file) => file.path === path)?.content : undefined;
  },

  async save(conversationId, input) {
    const { botId } = await assigned(conversationId);
    const existing = await db.query.skills.findFirst({ where: eq(skills.name, input.name) });
    const [skill] = existing
      ? await db
          .update(skills)
          .set({ description: input.description, body: input.body })
          .where(eq(skills.id, existing.id))
          .returning({ id: skills.id })
      : await db
          .insert(skills)
          .values({
            name: input.name,
            description: input.description,
            body: input.body,
            source: "bot",
          })
          .returning({ id: skills.id });
    if (botId) {
      // Already assigned is fine: the upsert's update was a no-op.
      await db
        .insert(botSkills)
        .values({ botId, skillId: skill!.id })
        .onConflictDoNothing({ target: [botSkills.botId, botSkills.skillId] });
    }
    return { created: !existing };
  },
};
