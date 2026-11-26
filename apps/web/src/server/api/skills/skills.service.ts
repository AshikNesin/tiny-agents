import { asc, eq } from "drizzle-orm";
import { Boom } from "@groot/core/errors";
import { fetchSkillFromGitHub, parseSkillMarkdown } from "./skills.parse";
import type { SkillData, SkillFile, SkillPreview } from "../../../shared/api/skills";
import type { CreateSkillDTO, PreviewSkillDTO, UpdateSkillDTO } from "./skills.schema";
import { db, skills, type Skill } from "../../db";
import { itemBotIds, setItemReach } from "../bots/bot-reach";

type SkillRow = Skill & { botIds: string[] };

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
    allBots: row.allBots,
    botIds: row.botIds,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function withBotIds(rows: Skill[]): Promise<SkillRow[]> {
  const reach = await itemBotIds("skills", rows);
  return rows.map((row) => ({ ...row, botIds: reach.get(row.id) ?? [] }));
}

async function findSkill(id: string): Promise<Skill> {
  const row = await db.query.skills.findFirst({ where: eq(skills.id, id) });
  if (!row) throw Boom.notFound("Skill not found");
  return row;
}

async function nameTaken(name: string, exceptId?: string): Promise<void> {
  const existing = await db.query.skills.findFirst({ where: eq(skills.name, name) });
  if (existing && existing.id !== exceptId) throw Boom.conflict(`A skill named "${name}" exists`);
}

async function setBots(skill: Skill, allBots: boolean, botIds: string[]): Promise<void> {
  await setItemReach("skills", { id: skill.id, allBots }, botIds);
}

export async function list(): Promise<SkillData[]> {
  const rows = await db.query.skills.findMany({ orderBy: asc(skills.name) });
  return (await withBotIds(rows)).map(toDTO);
}

export async function get(id: string): Promise<SkillData> {
  const row = await findSkill(id);
  const [withIds] = await withBotIds([row]);
  return toDTO(withIds!);
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
      allBots: data.allBots ?? data.botIds === undefined,
    })
    .onConflictDoNothing({ target: skills.name })
    .returning({ id: skills.id });
  if (!row) throw Boom.conflict(`A skill named "${data.name}" exists`);
  if (data.botIds) {
    const created = await findSkill(row.id);
    await setBots(created, created.allBots, data.botIds);
  }
  return get(row.id);
}

export async function update(id: string, data: UpdateSkillDTO): Promise<SkillData> {
  const current = await findSkill(id);
  if (data.name) await nameTaken(data.name, id);
  const changes = {
    ...(data.name !== undefined ? { name: data.name } : {}),
    ...(data.description !== undefined ? { description: data.description } : {}),
    ...(data.body !== undefined ? { body: data.body } : {}),
  };
  if (Object.keys(changes).length > 0) {
    await db.update(skills).set(changes).where(eq(skills.id, id));
  }
  if (data.botIds !== undefined || data.allBots !== undefined) {
    const botIds = data.botIds ?? (await get(id)).botIds;
    await setBots(current, data.allBots ?? current.allBots, botIds);
  }
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
