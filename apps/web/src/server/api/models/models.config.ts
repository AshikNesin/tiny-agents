import { parseJson } from "@tiny-agents/std";
import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { logger } from "@groot/core/logger";
import { VaultError, type AgentRuntime } from "@tiny-agents/agent";
import {
  PROVIDER_KINDS,
  type CredentialResolver,
  type ModelConfig,
  type ModelRole,
  type ProviderAccount,
  type ProviderKind,
  type ProviderStatus,
} from "@tiny-agents/models";
import { db, modelRoles, models, providers, vaultItems, type ProviderRow } from "../../db";
import { resolveProviderSecret } from "../vault/vault.service";
import { app } from "../../app-root";

const parseObject = (raw: string | null | undefined): Record<string, unknown> => {
  if (!raw) return {};
  try {
    return parseJson("A provider's stored options", raw, z.record(z.string(), z.unknown()));
  } catch {
    return {};
  }
};

function toAccount(row: ProviderRow): ProviderAccount {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as ProviderKind,
    baseUrl: row.baseUrl,
    hasCredential: row.credentialItemId !== null,
    viaProviderId: row.viaProviderId,
    settings: parseObject(row.settingsJson),
    enabled: row.enabled,
    status: row.status as ProviderStatus,
    statusDetail: row.statusDetail,
  };
}

export async function loadModelConfig(): Promise<ModelConfig> {
  const [providerRows, modelRows, roleRows] = await Promise.all([
    db.select().from(providers).orderBy(asc(providers.name)),
    db.select().from(models).orderBy(asc(models.name)),
    db.select().from(modelRoles),
  ]);
  return {
    providers: providerRows.map(toAccount),
    models: modelRows.map((row) => {
      const compat = row.compatJson ? parseObject(row.compatJson) : null;
      return {
        id: row.id,
        providerId: row.providerId,
        upstreamId: row.upstreamId,
        name: row.name,
        type: row.type === "classifier" ? "classifier" : "chat",
        enabled: row.enabled,
        contextWindow: row.contextWindow,
        maxOutputTokens: row.maxOutputTokens,
        imageInput: row.imageInput,
        reasoning: row.reasoning,
        compat,
        missing: row.missingSince !== null,
      };
    }),
    roles: Object.fromEntries(roleRows.map((row) => [row.role, row.modelId])) as Partial<
      Record<ModelRole, string>
    >,
  };
}

export function providerHost(row: Pick<ProviderRow, "kind" | "baseUrl">): string | undefined {
  const base = row.baseUrl ?? PROVIDER_KINDS[row.kind as ProviderKind]?.defaultBaseUrl;
  if (!base) return undefined;
  try {
    return new URL(base).host;
  } catch {
    return undefined;
  }
}

async function setStatus(id: string, status: ProviderStatus, detail: string | null) {
  await db
    .update(providers)
    .set({ status, statusDetail: detail, checkedAt: new Date() })
    .where(eq(providers.id, id));
}

export const vaultCredentials: CredentialResolver = {
  async resolve(providerId) {
    const row = await db.query.providers.findFirst({ where: eq(providers.id, providerId) });
    if (!row?.credentialItemId) return undefined;
    const item = await db.query.vaultItems.findFirst({
      where: eq(vaultItems.id, row.credentialItemId),
      columns: { handle: true },
    });
    const host = providerHost(row);
    if (!item || !host) return undefined;
    try {
      const key = await resolveProviderSecret(item.handle, { providerName: row.name, host });
      if (row.status === "locked") {
        await setStatus(providerId, "unchecked", null);
        await reloadModels();
      }
      return key;
    } catch (error) {
      if (!(error instanceof VaultError)) throw error;
      logger.warn({ provider: row.name, code: error.code }, "Provider key unavailable");
      if (row.status !== "locked") {
        await setStatus(providerId, "locked", error.message);
        await reloadModels();
      }
      return undefined;
    }
  },
};

export function bindModelRuntime(runtime: Pick<AgentRuntime, "applyModelConfig"> | undefined) {
  app().modelRuntime = runtime;
}

export function onModelsChanged(listener: () => void): () => void {
  const listeners = app().modelListeners;
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function reloadModels(): Promise<void> {
  const target = app().modelRuntime;
  if (target) target.applyModelConfig(await loadModelConfig());
  for (const listener of app().modelListeners) {
    try {
      listener();
    } catch (error) {
      logger.warn({ error }, "Models: a change listener threw after a reload");
    }
  }
}

export const FAUX_PROVIDER_ID = "faux";

export async function seedFauxModels(
  rows: readonly { id: string; name: string; imageInput?: boolean; reasoning?: boolean }[] = [
    { id: "test-model", name: "Test Model (faux)", reasoning: true },
  ],
): Promise<void> {
  await db
    .insert(providers)
    .values({ id: FAUX_PROVIDER_ID, name: "Faux", kind: "faux", status: "ok" })
    .onConflictDoNothing();
  if (rows.length === 0) return;
  await db
    .insert(models)
    .values(
      rows.map((row) => ({
        id: row.id,
        providerId: FAUX_PROVIDER_ID,
        upstreamId: row.id,
        name: row.name,
        source: "manual",
        contextWindow: 128_000,
        maxOutputTokens: 16_384,
        imageInput: row.imageInput ?? false,
        reasoning: row.reasoning ?? false,
      })),
    )
    .onConflictDoNothing();
}
