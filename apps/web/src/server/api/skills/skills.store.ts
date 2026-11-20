import { asc, eq } from "drizzle-orm";
import { botSkills, db, skills } from "../../db";
import type { SkillStore } from "@tiny-agents/agent";
import { conversationOwner } from "../bots/bots.owner";
import type { SkillFile } from "../../../shared/api/skills";

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
  const bot = owner.bot;
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
    const { botId, skills: own } = await assigned(conversationId);
    const mine = own.find((skill) => skill.name === input.name);
    if (mine) {
      await db
        .update(skills)
        .set({ description: input.description, body: input.body })
        .where(eq(skills.id, mine.id));
      return { created: false };
    }
    const taken = await db.query.skills.findFirst({
      where: eq(skills.name, input.name),
      columns: { id: true },
    });
    if (taken) {
      throw new Error(
        `A skill named "${input.name}" already exists and is not assigned to you. Pick another name, or ask the owner to assign it.`,
      );
    }
    const [skill] = await db
      .insert(skills)
      .values({ name: input.name, description: input.description, body: input.body, source: "bot" })
      .returning({ id: skills.id });
    if (botId) {
      await db
        .insert(botSkills)
        .values({ botId, skillId: skill!.id })
        .onConflictDoNothing({ target: [botSkills.botId, botSkills.skillId] });
    }
    return { created: true };
  },
};
