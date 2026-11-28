import { parseJson } from "@tiny-agents/std";
import { z } from "zod";
import { count, eq, isNotNull } from "drizzle-orm";
import { Boom } from "@groot/core/errors";
import type { ProviderKind } from "@tiny-agents/models";
import {
  bots,
  db,
  models,
  providers,
  vaultItems,
  type ModelRowRecord,
  type ProviderRow,
} from "../../db";
import { vaultCredentials } from "./models.config";
import type { Overrides } from "./models.schema";
import type { AccountData, AccountModel } from "../../../shared/api/models";

export const parseObject = (raw: string | null | undefined): Record<string, unknown> => {
  try {
    return parseJson("A provider's stored options", raw ?? "{}", z.record(z.string(), z.unknown()));
  } catch {
    return {};
  }
};

export function modelView(row: ModelRowRecord, usedBy: number): AccountModel {
  return {
    id: row.id,
    upstreamId: row.upstreamId,
    name: row.name,
    type: row.type as AccountModel["type"],
    source: row.source as AccountModel["source"],
    enabled: row.enabled,
    contextWindow: row.contextWindow,
    maxOutputTokens: row.maxOutputTokens,
    imageInput: row.imageInput,
    reasoning: row.reasoning,
    overrides: parseObject(row.overridesJson) as Overrides,
    compat: row.compatJson ? parseObject(row.compatJson) : null,
    missing: row.missingSince !== null,
    usedBy,
  };
}

export async function accountView(
  row: ProviderRow,
  usage: Map<string, number>,
): Promise<AccountData> {
  const [rows, item] = await Promise.all([
    db.select().from(models).where(eq(models.providerId, row.id)),
    row.credentialItemId
      ? db.query.vaultItems.findFirst({
          where: eq(vaultItems.id, row.credentialItemId),
          columns: { backend: true },
        })
      : undefined,
  ]);
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as ProviderKind,
    baseUrl: row.baseUrl,
    viaProviderId: row.viaProviderId,
    settings: parseObject(row.settingsJson),
    discovery: row.discovery as AccountData["discovery"],
    allowPrivateNetwork: row.allowPrivateNetwork,
    enabled: row.enabled,
    status: row.status as AccountData["status"],
    statusDetail: row.statusDetail,
    checkedAt: row.checkedAt,
    version: row.version,
    credential: item
      ? {
          hint: row.credentialHint,
          backend: item.backend as NonNullable<AccountData["credential"]>["backend"],
        }
      : null,
    models: rows
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((model) => modelView(model, usage.get(model.id) ?? 0)),
  };
}

export async function botUsage(): Promise<Map<string, number>> {
  const rows = await db
    .select({ modelId: bots.modelId, n: count() })
    .from(bots)
    .where(isNotNull(bots.modelId))
    .groupBy(bots.modelId);
  return new Map(rows.map((row) => [row.modelId!, row.n]));
}

export async function accountOrThrow(id: string): Promise<ProviderRow> {
  const row = await db.query.providers.findFirst({
    where: eq(providers.id, id),
  });
  if (!row) throw Boom.notFound("No such provider account");
  return row;
}

export async function modelOrThrow(id: string): Promise<ModelRowRecord> {
  const row = await db.query.models.findFirst({ where: eq(models.id, id) });
  if (!row) throw Boom.notFound("No such model");
  return row;
}

export async function storedKey(row: ProviderRow): Promise<string | undefined> {
  if (!row.credentialItemId) return undefined;
  const key = await vaultCredentials.resolve(row.id);
  if (!key) throw Boom.badRequest("The saved key can't be read. Re-enter it.");
  return key;
}
