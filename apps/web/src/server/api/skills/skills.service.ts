import { asc, eq, inArray } from "drizzle-orm";
import { Boom } from "@groot/core/errors";
import { fetchSkillFromGitHub, parseSkillMarkdown } from "./skills.parse";
import type { SkillData, SkillFile, SkillPreview } from "../../../shared/api/skills";
import type { CreateSkillDTO, PreviewSkillDTO, UpdateSkillDTO } from "./skills.schema";
import { botSkills, bots, db, skills, type Skill } from "../../db";

type SkillRow = Skill & {
  bots: { botId: string }[];
};

function toDTO(row: SkillRow): SkillData {
  let files: SkillFile[] = [];
  try {
    files = JSON.parse(row.files) as SkillFile[];
  } catch {}
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    body: row.body,
    files,
    source: row.source,
    sourceUrl: row.sourceUrl,
    botIds: row.bots.map((link) => link.botId),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const withBots = { bots: { columns: { botId: true } } } as const;

async function nameTaken(name: string, exceptId?: string): Promise<void> {
  const existing = await db.query.skills.findFirst({ where: eq(skills.name, name) });
  if (existing && existing.id !== exceptId) throw Boom.conflict(`A skill named "${name}" exists`);
}

async function setBots(skillId: string, botIds: string[]): Promise<void> {
  const found = await db.select({ id: bots.id }).from(bots).where(inArray(bots.id, botIds));
  db.transaction((tx) => {
    tx.delete(botSkills).where(eq(botSkills.skillId, skillId)).run();
    if (found.length > 0) {
      tx.insert(botSkills)
        .values(found.map((bot) => ({ botId: bot.id, skillId })))
        .run();
    }
  });
}

export async function list(): Promise<SkillData[]> {
  const rows = await db.query.skills.findMany({ with: withBots, orderBy: asc(skills.name) });
  return rows.map(toDTO);
}

export async function get(id: string): Promise<SkillData> {
  const row = await db.query.skills.findFirst({ where: eq(skills.id, id), with: withBots });
  if (!row) throw Boom.notFound("Skill not found");
  return toDTO(row);
}

export async function create(data: CreateSkillDTO): Promise<SkillData> {
  await nameTaken(data.name);
  const [row] = await db
    .insert(skills)
    .values({
      name: data.name,
      description: data.description,
      body: data.body,
      files: JSON.stringify(data.files),
      source: data.source,
      sourceUrl: data.sourceUrl ?? null,
    })
    .returning({ id: skills.id });
  if (data.botIds) await setBots(row!.id, data.botIds);
  return get(row!.id);
}

export async function update(id: string, data: UpdateSkillDTO): Promise<SkillData> {
  await get(id);
  if (data.name) await nameTaken(data.name, id);
  const changes = {
    ...(data.name !== undefined ? { name: data.name } : {}),
    ...(data.description !== undefined ? { description: data.description } : {}),
    ...(data.body !== undefined ? { body: data.body } : {}),
  };
  if (Object.keys(changes).length > 0) {
    await db.update(skills).set(changes).where(eq(skills.id, id));
  }
  if (data.botIds) await setBots(id, data.botIds);
  return get(id);
}

export async function remove(id: string): Promise<void> {
  await get(id);
  await db.delete(skills).where(eq(skills.id, id));
}

export async function preview(input: PreviewSkillDTO): Promise<SkillPreview> {
  const parsed =
    input.source === "paste"
      ? parseSkillMarkdown(input.content)
      : await fetchSkillFromGitHub(input.url);
  const exists =
    (await db.query.skills.findFirst({
      where: eq(skills.name, parsed.name),
      columns: { id: true },
    })) !== undefined;
  return {
    ...parsed,
    exists,
    warnings: exists
      ? [`A skill named "${parsed.name}" already exists. Rename it to install.`, ...parsed.warnings]
      : parsed.warnings,
  };
}
