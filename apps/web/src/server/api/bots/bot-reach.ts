import { eq } from "drizzle-orm";
import { botConnections, bots, botSkills, connections, db, skills } from "../../db";

export type ReachKind = "connections" | "skills";

interface Link {
  botId: string;
  itemId: string;
  enabled: boolean;
}

interface Item {
  id: string;
  allBots: boolean;
}

export function takesShared(bot: { projectId: string | null }): boolean {
  return bot.projectId === null;
}

function reaches(item: Item, shared: boolean, link: Link | undefined): boolean {
  return link ? link.enabled : item.allBots && shared;
}

function overrideFor(item: Item, shared: boolean, wanted: boolean): boolean | undefined {
  return wanted === (item.allBots && shared) ? undefined : wanted;
}

async function linksOf(kind: ReachKind, where: { botId?: string; itemId?: string }) {
  if (kind === "connections") {
    const rows = await db
      .select()
      .from(botConnections)
      .where(
        where.botId
          ? eq(botConnections.botId, where.botId)
          : where.itemId
            ? eq(botConnections.connectionId, where.itemId)
            : undefined,
      );
    return rows.map((row) => ({
      botId: row.botId,
      itemId: row.connectionId,
      enabled: row.enabled,
    }));
  }
  const rows = await db
    .select()
    .from(botSkills)
    .where(
      where.botId
        ? eq(botSkills.botId, where.botId)
        : where.itemId
          ? eq(botSkills.skillId, where.itemId)
          : undefined,
    );
  return rows.map((row) => ({ botId: row.botId, itemId: row.skillId, enabled: row.enabled }));
}

async function itemsOf(kind: ReachKind): Promise<Item[]> {
  const table = kind === "connections" ? connections : skills;
  return db.select({ id: table.id, allBots: table.allBots }).from(table);
}

async function sharedBots(): Promise<Map<string, boolean>> {
  const rows = await db.select({ id: bots.id, projectId: bots.projectId }).from(bots);
  return new Map(rows.map((row) => [row.id, takesShared(row)]));
}

export async function itemBotIds(kind: ReachKind, items: Item[]): Promise<Map<string, string[]>> {
  const shared = await sharedBots();
  const links = await linksOf(kind, {});
  const byItem = new Map<string, Map<string, Link>>();
  for (const link of links) {
    const forItem = byItem.get(link.itemId) ?? new Map<string, Link>();
    forItem.set(link.botId, link);
    byItem.set(link.itemId, forItem);
  }
  return new Map(
    items.map((item) => [
      item.id,
      [...shared]
        .filter(([botId, isShared]) => reaches(item, isShared, byItem.get(item.id)?.get(botId)))
        .map(([botId]) => botId),
    ]),
  );
}

export async function botItemIds(
  kind: ReachKind,
  bot: { id: string; projectId: string | null },
): Promise<string[]> {
  const shared = takesShared(bot);
  const links = new Map(
    (await linksOf(kind, { botId: bot.id })).map((link) => [link.itemId, link]),
  );
  return (await itemsOf(kind))
    .filter((item) => reaches(item, shared, links.get(item.id)))
    .map((item) => item.id);
}

function writeLinks(kind: ReachKind, scope: { botId?: string; itemId?: string }, rows: Link[]) {
  db.transaction((tx) => {
    if (kind === "connections") {
      tx.delete(botConnections)
        .where(
          scope.botId
            ? eq(botConnections.botId, scope.botId)
            : eq(botConnections.connectionId, scope.itemId!),
        )
        .run();
      if (rows.length > 0) {
        tx.insert(botConnections)
          .values(
            rows.map((row) => ({
              botId: row.botId,
              connectionId: row.itemId,
              enabled: row.enabled,
            })),
          )
          .run();
      }
      return;
    }
    tx.delete(botSkills)
      .where(scope.botId ? eq(botSkills.botId, scope.botId) : eq(botSkills.skillId, scope.itemId!))
      .run();
    if (rows.length > 0) {
      tx.insert(botSkills)
        .values(
          rows.map((row) => ({ botId: row.botId, skillId: row.itemId, enabled: row.enabled })),
        )
        .run();
    }
  });
}

export async function setBotReach(
  kind: ReachKind,
  bot: { id: string; projectId: string | null },
  wanted: Iterable<string>,
): Promise<void> {
  const shared = takesShared(bot);
  const on = new Set(wanted);
  const rows: Link[] = [];
  for (const item of await itemsOf(kind)) {
    const enabled = overrideFor(item, shared, on.has(item.id));
    if (enabled !== undefined) rows.push({ botId: bot.id, itemId: item.id, enabled });
  }
  writeLinks(kind, { botId: bot.id }, rows);
}

export async function setItemReach(
  kind: ReachKind,
  item: Item,
  wanted: Iterable<string>,
): Promise<string[]> {
  const before = (await itemBotIds(kind, [item])).get(item.id) ?? [];
  const shared = await sharedBots();
  const on = new Set(wanted);
  const table = kind === "connections" ? connections : skills;
  await db.update(table).set({ allBots: item.allBots }).where(eq(table.id, item.id));
  const rows: Link[] = [];
  for (const [botId, isShared] of shared) {
    const enabled = overrideFor(item, isShared, on.has(botId));
    if (enabled !== undefined) rows.push({ botId, itemId: item.id, enabled });
  }
  writeLinks(kind, { itemId: item.id }, rows);
  const after = (await itemBotIds(kind, [item])).get(item.id) ?? [];
  return [...new Set([...before, ...after])];
}

export async function reachBot(
  id: string,
): Promise<{ id: string; projectId: string | null } | undefined> {
  const row = await db.query.bots.findFirst({
    where: eq(bots.id, id),
    columns: { id: true, projectId: true },
  });
  if (!row) return undefined;
  return { id: row.id, projectId: row.projectId };
}
