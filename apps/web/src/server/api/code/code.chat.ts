import { eq } from "drizzle-orm";
import { Boom } from "@groot/core/errors";
import { bots, db } from "../../db";
import { createBot, getBot } from "../bots/bots.service";
import { getAgentRuntime } from "../bots/bots.runtime";
import type { Bot } from "../bots/bots.conversation";
import { getProject, repoOf } from "./code.projects";

async function chatOf(projectId: string): Promise<Bot | undefined> {
  const row = await db.query.bots.findFirst({
    where: eq(bots.projectId, projectId),
    columns: { id: true },
  });
  return row ? getBot(row.id) : undefined;
}

async function freeName(base: string): Promise<string> {
  const taken = new Set(
    (await db.select({ name: bots.name }).from(bots)).map((row) => row.name.trim().toLowerCase()),
  );
  const candidates = [base, `${base} project`];
  for (let n = 2; n <= 20; n += 1) candidates.push(`${base} project ${n}`);
  return candidates.find((name) => !taken.has(name.toLowerCase())) ?? `${base} ${Date.now()}`;
}

export async function openProjectChat(projectId: string): Promise<Bot> {
  const project = await getProject(projectId);
  const existing = await chatOf(project.id);
  if (existing) return existing;
  const rt = getAgentRuntime();
  const modelId = rt.catalog.forRole("bot_default")?.id;
  if (!modelId) throw Boom.badRequest("Set up a model first, in Settings, Models.");
  const repo = repoOf(project);
  try {
    return await createBot(
      {
        name: await freeName(project.name),
        description: `Project chat for ${repo.owner}/${repo.name}`,
        systemPrompt: "",
        modelId,
        projectId: project.id,
      },
      rt,
    );
  } catch (error) {
    const raced = await chatOf(project.id);
    if (raced) return raced;
    throw error;
  }
}
