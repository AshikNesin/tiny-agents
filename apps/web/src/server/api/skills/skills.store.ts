/**
 * SkillStore adapter: the agent's `skills` capability reads the skills
 * assigned to the bot behind a conversation from app.db. Dependency direction
 * stays one-way — `@tiny-agents/agent` defines the port, apps/web implements it.
 */
import { prisma } from "@groot/core/database";
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
  const bot = await prisma.bot.findUnique({
    where: { id: owner.botId },
    select: {
      id: true,
      skills: { select: { skill: true }, orderBy: { skill: { name: "asc" } } },
    },
  });
  return { botId: bot?.id, skills: bot?.skills.map((link) => link.skill) ?? [] };
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
    const existing = await prisma.skill.findUnique({ where: { name: input.name } });
    const skill = existing
      ? await prisma.skill.update({
          where: { id: existing.id },
          data: { description: input.description, body: input.body },
        })
      : await prisma.skill.create({
          data: { ...input, source: "bot" },
        });
    if (botId) {
      await prisma.botSkill.upsert({
        where: { botId_skillId: { botId, skillId: skill.id } },
        create: { botId, skillId: skill.id },
        update: {},
      });
    }
    return { created: !existing };
  },
};
