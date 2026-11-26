import { eq, inArray } from "drizzle-orm";
import { Boom } from "@groot/core/errors";
import { AgentRuntime } from "@tiny-agents/agent";
import {
  db,
  botConnections,
  bots,
  botSkills,
  connections,
  promptRevisions,
  skills,
} from "../../db";
import { getAgentRuntime } from "./bots.runtime";
import { releaseBot } from "./bot-resources";
import {
  findBotRow,
  startBotConversation,
  reconcileBotConversation,
  toBot,
  type Bot,
} from "./bots.conversation";
import type { CreateBotDTO, UpdateBotDTO } from "./bots.schema";
import { listBots as listBotEntries } from "./bots.list";
import type { Viewer } from "../people/access";
import { markGuestRead, setBotGuests } from "../people/people.service";

export type BotAgentRuntime = Pick<
  AgentRuntime,
  | "createConversation"
  | "configure"
  | "submit"
  | "abort"
  | "withdraw"
  | "readChatPage"
  | "readChat"
  | "catalog"
  | "busyConversations"
  | "listCapabilities"
  | "pendingApprovals"
  | "decideApproval"
  | "yolo"
  | "setYolo"
  | "pendingQuestions"
  | "answerQuestions"
  | "dismissQuestions"
  | "isBusy"
  | "fork"
>;

function runtime(): BotAgentRuntime {
  return getAgentRuntime();
}

export async function listBots(rt: BotAgentRuntime = runtime(), viewer?: Viewer) {
  return listBotEntries(rt, viewer);
}

export async function getBot(id: string): Promise<Bot> {
  return toBot(await findBotRow(id));
}

function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

async function assertNameFree(name: string, selfId?: string): Promise<void> {
  const rows = await db.select({ id: bots.id, name: bots.name }).from(bots);
  const taken = rows.find((row) => row.id !== selfId && nameKey(row.name) === nameKey(name));
  if (taken) throw Boom.conflict(`A bot named "${taken.name}" already exists`);
}

export async function createBot(
  data: CreateBotDTO & { projectId?: string },
  rt: BotAgentRuntime = runtime(),
) {
  if (!rt.catalog.get(data.modelId)) {
    throw Boom.badRequest("Unknown model. Pick one set up in Settings → Models.");
  }
  await assertNameFree(data.name);
  const toolPermissions = data.toolPermissions ?? {};
  const conversationId = await startBotConversation(
    {
      modelId: data.modelId,
      projectId: data.projectId ?? null,
      systemPrompt: data.systemPrompt,
      toolPermissions,
      autoReview: data.autoReview,
      yoloByDefault: data.yoloByDefault,
    },
    rt,
  );
  const [row] = await db
    .insert(bots)
    .values({
      name: data.name,
      description: data.description,
      systemPrompt: data.systemPrompt,
      modelId: data.modelId,
      conversationId,
      chatStartedAt: new Date(),
      toolPermissions: JSON.stringify(toolPermissions),
      ...(data.memoryEnabled !== undefined ? { memoryEnabled: data.memoryEnabled } : {}),
      ...(data.autoReview !== undefined ? { autoReview: data.autoReview } : {}),
      ...(data.yoloByDefault !== undefined ? { yoloByDefault: data.yoloByDefault } : {}),
      ...(data.browserProfile !== undefined ? { browserProfile: data.browserProfile } : {}),
      ...(data.projectId ? { projectId: data.projectId } : {}),
    })
    .returning();
  if (!row) throw new Error("Bot insert returned no row");
  if (data.skillIds || data.connectionIds || data.guestIds?.length) {
    await setLinks(row.id, data.skillIds, data.connectionIds);
    if (data.guestIds?.length) await setBotGuests(row.id, data.guestIds);
    return reconcileBotConversation(row.id, rt);
  }
  return getBot(row.id);
}

async function setLinks(botId: string, skillIds?: string[], connectionIds?: string[]) {
  if (skillIds) {
    const known = await db
      .select({ id: skills.id })
      .from(skills)
      .where(inArray(skills.id, skillIds));
    db.transaction((tx) => {
      tx.delete(botSkills).where(eq(botSkills.botId, botId)).run();
      if (known.length > 0) {
        tx.insert(botSkills)
          .values(known.map((skill) => ({ botId, skillId: skill.id })))
          .run();
      }
    });
  }
  if (connectionIds) {
    const known = await db
      .select({ id: connections.id })
      .from(connections)
      .where(inArray(connections.id, connectionIds));
    db.transaction((tx) => {
      tx.delete(botConnections).where(eq(botConnections.botId, botId)).run();
      if (known.length > 0) {
        tx.insert(botConnections)
          .values(known.map((connection) => ({ botId, connectionId: connection.id })))
          .run();
      }
    });
  }
}

export async function updateBot(id: string, data: UpdateBotDTO, rt: BotAgentRuntime = runtime()) {
  const before = await findBotRow(id);
  const memoryResumed = data.memoryEnabled === true && !before.memoryEnabled;
  if (data.modelId !== undefined && !rt.catalog.get(data.modelId)) {
    throw Boom.badRequest("Unknown model. Pick one set up in Settings → Models.");
  }
  if (data.name !== undefined) await assertNameFree(data.name, id);
  await setLinks(id, data.skillIds, data.connectionIds);
  if (data.guestIds !== undefined) await setBotGuests(id, data.guestIds);
  if (data.systemPrompt !== undefined && data.systemPrompt !== before.systemPrompt) {
    await db
      .insert(promptRevisions)
      .values({ botId: id, prompt: data.systemPrompt, source: "manual" });
  }
  await updateBotRow(id, {
    ...(data.toolPermissions !== undefined
      ? { toolPermissions: JSON.stringify(data.toolPermissions) }
      : {}),
    ...(data.name !== undefined ? { name: data.name } : {}),
    ...(data.description !== undefined ? { description: data.description } : {}),
    ...(data.systemPrompt !== undefined ? { systemPrompt: data.systemPrompt } : {}),
    ...(data.modelId !== undefined ? { modelId: data.modelId } : {}),
    ...(data.memoryEnabled !== undefined ? { memoryEnabled: data.memoryEnabled } : {}),
    ...(memoryResumed ? { memoryCapturedThrough: new Date() } : {}),
    ...(data.autoReview !== undefined ? { autoReview: data.autoReview } : {}),
    ...(data.yoloByDefault !== undefined ? { yoloByDefault: data.yoloByDefault } : {}),
    ...(data.browserProfile !== undefined ? { browserProfile: data.browserProfile } : {}),
  });
  return reconcileBotConversation(id, rt);
}

export async function updateBotRow(
  id: string,
  data: Partial<typeof bots.$inferInsert>,
): Promise<void> {
  const changes = Object.fromEntries(
    Object.entries(data).filter(([, value]) => value !== undefined),
  ) as Partial<typeof bots.$inferInsert>;
  if (Object.keys(changes).length === 0) {
    const row = await db.query.bots.findFirst({ where: eq(bots.id, id), columns: { id: true } });
    if (!row) throw Boom.notFound("Record not found");
    return;
  }
  const [updated] = await db
    .update(bots)
    .set(changes)
    .where(eq(bots.id, id))
    .returning({ id: bots.id });
  if (!updated) throw Boom.notFound("Record not found");
}

export async function deleteBot(id: string, rt: BotAgentRuntime = runtime()) {
  return toBot(await releaseBot(id, rt));
}

export async function setPinned(id: string, pinned: boolean) {
  const row = await findBotRow(id);
  const pinnedAt = pinned ? (row.pinnedAt ?? new Date()) : null;
  await updateBotRow(id, { pinnedAt });
  return getBot(id);
}

export async function markRead(id: string, viewer?: Viewer) {
  await findBotRow(id);
  if (viewer?.kind === "guest") await markGuestRead(id, viewer.userId);
  else await updateBotRow(id, { lastReadAt: new Date() });
  return getBot(id);
}
