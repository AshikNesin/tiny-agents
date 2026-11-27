import { eq } from "drizzle-orm";
import { botSkills, db, skills } from "../../db";
import { reachBot, reachedSkills } from "../bots/bot-reach";
import type { SkillStore } from "@tiny-agents/agent";
import { conversationOwner } from "../bots/bots.owner";
import { skillFiles } from "./skills.parse";

async function assigned(conversationId: number) {
  const owner = await conversationOwner(conversationId);
  if (!owner) return { botId: undefined, skills: await reachedSkills("code-thread") };
  const bot = await reachBot(owner.bot.id);
  if (!bot) return { botId: undefined, skills: [] };
  return { botId: bot.id, skills: await reachedSkills(bot) };
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
      files: skillFiles(skill.files).map((file) => file.path),
    };
  },

  async readFile(conversationId, name, path) {
    const skill = (await assigned(conversationId)).skills.find((s) => s.name === name);
    return skill ? skillFiles(skill.files).find((file) => file.path === path)?.content : undefined;
  },

  async save(conversationId, input) {
    const { botId, skills: own } = await assigned(conversationId);
    if (!botId) throw new Error("Only a bot can save skills.");
    const mine = own.find((skill) => skill.name === input.name);
    if (mine) {
      await db
        .update(skills)
        .set({ description: input.description, body: input.body })
        .where(eq(skills.id, mine.id));
      return { created: false };
    }
    const [skill] = await db
      .insert(skills)
      .values({
        name: input.name,
        description: input.description,
        body: input.body,
        source: "bot",
        allBots: false,
      })
      .onConflictDoNothing({ target: skills.name })
      .returning({ id: skills.id });
    if (!skill) {
      throw new Error(
        `A skill named "${input.name}" already exists and is not assigned to you. Pick another name, or ask the owner to assign it.`,
      );
    }
    await db
      .insert(botSkills)
      .values({ botId, skillId: skill!.id })
      .onConflictDoNothing({ target: [botSkills.botId, botSkills.skillId] });
    return { created: true };
  },
};
