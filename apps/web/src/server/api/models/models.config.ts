/**
 * Models are owner data (issue #179, ADR 0016): provider accounts, model rows
 * and role assignments live in the database. This module reads them into the
 * plain `ModelConfig` snapshot the runtime projects onto pi-ai, resolves an
 * account's key through the vault (`app` items, the `provider` sink), and
 * pushes every committed change to the runtime and to `/events`.
 */
import { asc, eq } from "drizzle-orm";
import { logger } from "@groot/core/logger";
import {
  PROVIDER_KINDS,
  VaultError,
  type AgentRuntime,
  type CredentialResolver,
  type ModelConfig,
  type ModelRole,
  type ProviderAccount,
  type ProviderKind,
  type ProviderStatus,
} from "@tiny-agents/agent";
import { db, modelRoles, models, providers, vaultItems, type ProviderRow } from "../../db";
import { resolveProviderSecret } from "../vault/vault.service";

const parseObject = (raw: string | null | undefined): Record<string, unknown> => {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
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

/** The owner's model configuration, as the runtime takes it. */
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

/** The host a provider account's requests go to (what its key's vault item must list). */
function providerHost(row: Pick<ProviderRow, "kind" | "baseUrl">): string | undefined {
  const base = row.baseUrl ?? PROVIDER_KINDS[row.kind as ProviderKind]?.defaultBaseUrl;
  if (!base) return undefined;
  try {
    return new URL(base).host;
  } catch {
    return undefined;
  }
}

/** Mark an account's status (a key the vault can't open is `locked`). */
async function setStatus(id: string, status: ProviderStatus, detail: string | null) {
  await db
    .update(providers)
    .set({ status, statusDetail: detail, checkedAt: new Date() })
    .where(eq(providers.id, id));
}

/**
 * Account keys from the vault: the account's `app` item, for the account's
 * own host. A refusal or an unreadable value leaves the account `locked` with
 * the reason, and the request goes out unauthenticated (the provider says no).
 */
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
      const key = await resolveProviderSecret(item.handle, { providerId, host });
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

// ── Live updates ────────────────────────────────────────────────────────

let target: Pick<AgentRuntime, "applyModelConfig"> | undefined;
const listeners = new Set<() => void>();

/** Bind the runtime that `reloadModels` updates (boot, tests). */
export function bindModelRuntime(runtime: Pick<AgentRuntime, "applyModelConfig"> | undefined) {
  target = runtime;
}

/** Listen for committed model changes (`/events` sends `models.changed`). */
export function onModelsChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** After a commit: hand the runtime the new snapshot and tell the pickers. */
async function reloadModels(): Promise<void> {
  if (target) target.applyModelConfig(await loadModelConfig());
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // a listener must not break the others
    }
  }
}

// ── Faux (dev, e2e, tests) ──────────────────────────────────────────────

/** The faux account's id: also the pi-ai provider id the host's faux provider uses. */
const FAUX_PROVIDER_ID = "faux";

/**
 * Make sure the faux account and the given models exist (TINY_AGENTS_FAUX
 * boots and tests). Each model's row id is its upstream id, so a faux bot
 * names its model `test-model` everywhere. Existing rows are left as they are.
 */
export async function seedFauxModels(
  rows: readonly { id: string; name: string; imageInput?: boolean; reasoning?: boolean }[] = [
    { id: "test-model", name: "Test Model (faux)", reasoning: true },
  ],
): Promise<void> {
  await db
    .insert(providers)
    .values({ id: FAUX_PROVIDER_ID, name: "Faux", kind: "faux", status: "ok" })
    .onConflictDoNothing();
  for (const row of rows) {
    await db
      .insert(models)
      .values({
        id: row.id,
        providerId: FAUX_PROVIDER_ID,
        upstreamId: row.id,
        name: row.name,
        source: "manual",
        contextWindow: 128_000,
        maxOutputTokens: 16_384,
        imageInput: row.imageInput ?? false,
        reasoning: row.reasoning ?? false,
      })
      .onConflictDoNothing();
  }
}
