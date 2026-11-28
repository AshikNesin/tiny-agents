import { randomBytes } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { Boom, HttpError } from "@groot/core/errors";
import {
  PROVIDER_KINDS,
  PROVIDER_TEMPLATES,
  resolveCapabilities,
  type DiscoveredModel,
} from "@tiny-agents/models";
import { bots, db, modelRoles, models, providers, vaultItems, type ProviderRow } from "../../db";
import { fauxMode } from "../../env";
import { createAppCredential, deleteItemRow } from "../vault/vault.admin.service";
import { providerHost, reloadModels } from "./models.config";
import type { CreateAccountDTO, Overrides, UpdateConnectionDTO } from "./models.schema";
import type { Deleted } from "../../../shared/api/common";
import type {
  AccountData,
  AccountListData,
  AccountModel,
  AccountRefreshData,
} from "../../../shared/api/models";
import {
  accountOrThrow,
  accountView,
  botUsage,
  modelOrThrow,
  modelView,
  parseObject,
  storedKey,
} from "./models.records";
import {
  canonicalEndpoint,
  refuseClaudeToken,
  settingsFor,
  type Endpoint,
  type Kind,
} from "./models.endpoint";
import { discoverAt, discoverNew } from "./models.discovery";

const WORKERS_AI_HOST = "api.cloudflare.com";

const INJECT: Record<Exclude<Kind, "claude-plan">, { name: string; format: string }> = {
  anthropic: { name: "x-api-key", format: "{value}" },
  "openai-chat": { name: "Authorization", format: "Bearer {value}" },
  "openai-responses": { name: "Authorization", format: "Bearer {value}" },
  gemini: { name: "x-goog-api-key", format: "{value}" },
  "cloudflare-ai-gateway": {
    name: "cf-aig-authorization",
    format: "Bearer {value}",
  },
};

function keyHint(key: string): string {
  const tail = key.slice(-4);
  const head = key.match(/^[A-Za-z]+[-_]/)?.[0] ?? "";
  return `${head}…${tail}`;
}

export async function listAccounts(): Promise<AccountListData> {
  const [usage, rows] = await Promise.all([botUsage(), db.select().from(providers)]);
  return {
    accounts: await Promise.all(
      rows
        .filter((row) => row.kind !== "faux" || fauxMode())
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((row) => accountView(row, usage)),
    ),
    templates: PROVIDER_TEMPLATES,
  };
}

async function storeKey(kind: Kind, name: string, baseUrl: string | null, key: string) {
  if (kind === "claude-plan") throw Boom.badRequest("The Claude plan takes no key.");
  const host = providerHost({ kind, baseUrl });
  if (!host) throw Boom.badRequest("Set the endpoint before the key.");
  const hosts = kind === "cloudflare-ai-gateway" ? [host, WORKERS_AI_HOST] : [host];
  const handle = `provider-${name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30)}-${randomBytes(3).toString("hex")}`;
  return createAppCredential({
    handle,
    label: `Model provider: ${name}`,
    value: key,
    hosts,
    inject: { as: "header", ...INJECT[kind] },
  });
}

function modelValues(
  providerId: string,
  found: DiscoveredModel,
  source: "discovered" | "manual",
  options: {
    enabled?: boolean;
    overrides?: Overrides;
    compat?: Record<string, unknown> | null;
  } = {},
) {
  const overrides = options.overrides ?? {};
  return {
    providerId,
    upstreamId: found.upstreamId,
    name: found.name,
    type: found.type,
    source,
    enabled: options.enabled ?? true,
    contextWindow: overrides.contextWindow ?? found.contextWindow,
    maxOutputTokens: overrides.maxOutputTokens ?? found.maxOutputTokens,
    imageInput: overrides.imageInput ?? found.imageInput,
    reasoning: overrides.reasoning ?? found.reasoning,
    overridesJson: JSON.stringify(overrides),
    compatJson:
      options.compat !== undefined
        ? options.compat && JSON.stringify(options.compat)
        : found.compat && JSON.stringify(found.compat),
  };
}

export async function createAccount(input: CreateAccountDTO): Promise<AccountData> {
  refuseClaudeToken(input.apiKey);
  const kind = input.kind;
  if (kind === "claude-plan") {
    const existing = await db.query.providers.findFirst({
      where: eq(providers.kind, kind),
    });
    if (existing) throw Boom.conflict("There is already a Claude plan account.");
  }
  if (input.viaProviderId) {
    if (kind !== "openai-chat")
      throw Boom.badRequest("Only OpenAI Chat can route through a gateway.");
    const gateway = await accountOrThrow(input.viaProviderId);
    if (gateway.kind !== "cloudflare-ai-gateway") {
      throw Boom.badRequest("That account is not a Cloudflare AI Gateway.");
    }
  }
  const settings = settingsFor(input);
  const baseUrl = canonicalEndpoint({
    ...input,
    kind,
    baseUrl: input.baseUrl ?? null,
  });
  const keyNeeded =
    kind !== "claude-plan" &&
    !input.viaProviderId &&
    !PROVIDER_TEMPLATES.some((t) => t.keyless && t.baseUrl === baseUrl) &&
    !input.allowPrivateNetwork;
  if (keyNeeded && !input.apiKey) throw Boom.badRequest("Enter the API key.");

  if (input.discovery === "manual" && !input.model && input.models.length === 0) {
    throw Boom.badRequest("Add a model.");
  }
  const found =
    input.discovery === "auto"
      ? await discoverNew({ ...input, kind, baseUrl })
      : input.model
        ? [
            resolveCapabilities(
              kind,
              baseUrl,
              input.model.upstreamId,
              input.model.name ?? input.model.upstreamId,
            ),
          ]
        : input.models.map((upstreamId) => resolveCapabilities(kind, baseUrl, upstreamId));
  const wanted = new Set(input.models);
  const chosen = input.discovery === "auto" ? found.filter((m) => wanted.has(m.upstreamId)) : found;

  const name =
    input.name ??
    PROVIDER_TEMPLATES.find((t) => t.kind === kind && t.baseUrl === baseUrl)?.label ??
    (baseUrl ? new URL(baseUrl).host : PROVIDER_KINDS[kind].label);
  const item = input.apiKey ? await storeKey(kind, name, baseUrl, input.apiKey) : undefined;
  const account = db.transaction((tx) => {
    if (kind === "claude-plan") {
      const plan = tx
        .select({ id: providers.id })
        .from(providers)
        .where(eq(providers.kind, kind))
        .get();
      if (plan) throw Boom.conflict("There is already a Claude plan account.");
    }
    return tx
      .insert(providers)
      .values({
        name,
        kind,
        baseUrl: input.viaProviderId ? null : baseUrl,
        credentialItemId: item?.id ?? null,
        credentialHint: input.apiKey ? keyHint(input.apiKey) : null,
        viaProviderId: input.viaProviderId ?? null,
        settingsJson: JSON.stringify(settings),
        discovery: input.discovery,
        allowPrivateNetwork: input.allowPrivateNetwork,
        status: input.discovery === "auto" && !input.viaProviderId ? "ok" : "unchecked",
        checkedAt: input.discovery === "auto" ? new Date() : null,
      })
      .returning()
      .get();
  });
  if (chosen.length > 0) {
    await db.insert(models).values(
      chosen.map((m) =>
        modelValues(account.id, m, input.discovery === "auto" ? "discovered" : "manual", {
          ...(input.model?.overrides ? { overrides: input.model.overrides } : {}),
          ...(input.model?.compat !== undefined ? { compat: input.model.compat } : {}),
        }),
      ),
    );
  }
  await reloadModels();
  return accountView(account, await botUsage());
}

export async function patchAccount(
  id: string,
  input: {
    name?: string;
    enabled?: boolean;
    fallbackModelId?: string | null;
    maxTurns?: number | "unlimited" | null;
  },
  ifMatch: number | undefined,
): Promise<AccountData> {
  const row = await accountOrThrow(id);
  if (ifMatch !== undefined && ifMatch !== row.version) {
    throw new HttpError(412, "The account changed meanwhile. Reload and try again.");
  }
  const settings = parseObject(row.settingsJson);
  if (input.fallbackModelId !== undefined) {
    if (row.kind !== "claude-plan") throw Boom.badRequest("Only the Claude plan has a fallback.");
    if (input.fallbackModelId) {
      const target = await modelOrThrow(input.fallbackModelId);
      const owner = await accountOrThrow(target.providerId);
      if (owner.kind === "claude-plan" || target.type !== "chat") {
        throw Boom.badRequest("The fallback must be a chat model that runs on pi.");
      }
      settings.fallbackModelId = input.fallbackModelId;
    } else delete settings.fallbackModelId;
  }
  if (input.maxTurns !== undefined) {
    if (row.kind !== "claude-plan") throw Boom.badRequest("Only the Claude plan has max turns.");
    if (input.maxTurns) settings.maxTurns = input.maxTurns;
    else delete settings.maxTurns;
  }
  const [updated] = await db
    .update(providers)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      settingsJson: JSON.stringify(settings),
      version: row.version + 1,
    })
    .where(and(eq(providers.id, id), eq(providers.version, row.version)))
    .returning();
  if (!updated) throw new HttpError(412, "The account changed meanwhile. Reload and try again.");
  await reloadModels();
  return accountView(updated, await botUsage());
}

async function addListed(providerId: string, found: readonly DiscoveredModel[]) {
  const have = await savedUpstreamIds(providerId);
  const fresh = found.filter((m) => !have.has(m.upstreamId));
  if (fresh.length === 0) return;
  await db.insert(models).values(fresh.map((m) => modelValues(providerId, m, "discovered")));
}

async function markListed(providerId: string, found: readonly DiscoveredModel[]) {
  const listed = new Set(found.flatMap((m) => [m.upstreamId, ...(m.aliases ?? [])]));
  const rows = await db.select().from(models).where(eq(models.providerId, providerId));
  const now = new Date();
  const changed = rows.filter((row) => !listed.has(row.upstreamId) !== (row.missingSince !== null));
  const gone = changed.filter((row) => !listed.has(row.upstreamId)).map((row) => row.id);
  const back = changed.filter((row) => listed.has(row.upstreamId)).map((row) => row.id);
  if (gone.length > 0) {
    await db.update(models).set({ missingSince: now }).where(inArray(models.id, gone));
  }
  if (back.length > 0) {
    await db.update(models).set({ missingSince: null }).where(inArray(models.id, back));
  }
}

export async function updateConnection(
  id: string,
  input: UpdateConnectionDTO,
): Promise<AccountData> {
  refuseClaudeToken(input.apiKey);
  const row = await accountOrThrow(id);
  const kind = row.kind as Kind;
  if (kind === "claude-plan") throw Boom.badRequest("The Claude plan has no connection to edit.");
  const allowPrivateNetwork = input.allowPrivateNetwork ?? row.allowPrivateNetwork;
  const baseUrl =
    input.baseUrl !== undefined
      ? canonicalEndpoint({
          kind,
          baseUrl: input.baseUrl,
          allowPrivateNetwork,
          viaProviderId: row.viaProviderId,
        })
      : row.baseUrl;
  const before = providerHost(row);
  const after = providerHost({ kind, baseUrl });
  if (before !== after && row.credentialItemId && !input.apiKey) {
    throw Boom.badRequest("The endpoint's host changed: enter the key for the new endpoint.");
  }
  const settings = input.settings
    ? settingsFor({
        ...input,
        kind,
        settings: input.settings,
        viaProviderId: row.viaProviderId,
      } as CreateAccountDTO)
    : parseObject(row.settingsJson);
  const key = input.apiKey ?? (await storedKey(row));
  const found =
    row.discovery === "auto"
      ? await discoverAt({
          kind,
          baseUrl,
          ...(key ? { apiKey: key } : {}),
          allowPrivateNetwork,
          viaProviderId: row.viaProviderId,
          settings: settings as Endpoint["settings"],
        })
      : undefined;
  const item = input.apiKey ? await storeKey(kind, row.name, baseUrl, input.apiKey) : undefined;
  const [updated] = await db
    .update(providers)
    .set({
      baseUrl,
      allowPrivateNetwork,
      settingsJson: JSON.stringify(settings),
      ...(item ? { credentialItemId: item.id, credentialHint: keyHint(input.apiKey!) } : {}),
      status: found ? "ok" : "unchecked",
      statusDetail: null,
      checkedAt: found ? new Date() : row.checkedAt,
      version: row.version + 1,
    })
    .where(and(eq(providers.id, id), eq(providers.version, row.version)))
    .returning();
  if (!updated) {
    if (item) await removeKey(item.id);
    const gone = await db.query.providers.findFirst({
      where: eq(providers.id, id),
    });
    if (!gone) throw Boom.notFound("No such provider account");
    throw new HttpError(412, "The account changed meanwhile. Reload and try again.");
  }
  if (item && row.credentialItemId) await removeKey(row.credentialItemId);
  if (found) await markListed(id, found);
  await reloadModels();
  return accountView(updated!, await botUsage());
}

async function removeKey(itemId: string): Promise<void> {
  const item = await db.query.vaultItems.findFirst({
    where: eq(vaultItems.id, itemId),
  });
  if (item) await deleteItemRow(item, { purge: true });
}

async function discoverSaved(row: ProviderRow): Promise<DiscoveredModel[]> {
  const key = await storedKey(row);
  return discoverAt({
    kind: row.kind as Kind,
    baseUrl: row.baseUrl,
    ...(key ? { apiKey: key } : {}),
    allowPrivateNetwork: row.allowPrivateNetwork,
    viaProviderId: row.viaProviderId,
    settings: parseObject(row.settingsJson) as Endpoint["settings"],
  });
}

async function savedUpstreamIds(id: string): Promise<Set<string>> {
  const rows = await db
    .select({ upstreamId: models.upstreamId })
    .from(models)
    .where(eq(models.providerId, id));
  return new Set(rows.map((m) => m.upstreamId));
}

export async function availableModels(id: string): Promise<DiscoveredModel[]> {
  const row = await accountOrThrow(id);
  if (row.kind === "faux") return [];
  const [found, have] = await Promise.all([discoverSaved(row), savedUpstreamIds(id)]);
  return found.filter((m) => !have.has(m.upstreamId));
}

export async function refreshAccount(id: string): Promise<AccountRefreshData> {
  const row = await accountOrThrow(id);
  let found: DiscoveredModel[];
  try {
    found = await discoverSaved(row);
  } catch (error) {
    const code = error instanceof HttpError ? error.code : undefined;
    await db
      .update(providers)
      .set({
        status: code === "key_rejected" ? "key_rejected" : "unreachable",
        statusDetail: (error as Error).message.slice(0, 500),
        checkedAt: new Date(),
      })
      .where(eq(providers.id, id));
    await reloadModels();
    throw error;
  }
  await db
    .update(providers)
    .set({ status: "ok", statusDetail: null, checkedAt: new Date() })
    .where(eq(providers.id, id));
  if (row.discovery === "auto") await markListed(id, found);
  if (row.kind === "claude-plan") await addListed(id, found);
  await reloadModels();
  const have = await savedUpstreamIds(id);
  return {
    account: await accountView(await accountOrThrow(id), await botUsage()),
    available: found.filter((m) => !have.has(m.upstreamId)),
  };
}

async function usage(modelIds: readonly string[]) {
  if (modelIds.length === 0) return { bots: [], roles: [] };
  const [botRows, roleRows] = await Promise.all([
    db
      .select({ id: bots.id, name: bots.name })
      .from(bots)
      .where(inArray(bots.modelId, [...modelIds])),
    db
      .select({ role: modelRoles.role })
      .from(modelRoles)
      .where(inArray(modelRoles.modelId, [...modelIds])),
  ]);
  return { bots: botRows, roles: roleRows.map((r) => r.role) };
}

async function moveOrRefuse(from: readonly string[], moveTo: string | undefined) {
  const [users, plan] = await Promise.all([
    usage(from),
    db.query.providers.findFirst({ where: eq(providers.kind, "claude-plan") }),
  ]);
  const fallback = parseObject(plan?.settingsJson).fallbackModelId;
  const fallsBack = typeof fallback === "string" && from.includes(fallback);
  if (users.bots.length === 0 && users.roles.length === 0 && !fallsBack) return;
  if (!moveTo) {
    throw Boom.conflict("In use", {
      in_use: { ...users, claudePlanFallback: fallsBack },
    });
  }
  if (from.includes(moveTo)) throw Boom.badRequest("Move them to another model.");
  const target = await modelOrThrow(moveTo);
  const classifierRole = users.roles.includes("classifier");
  const chatUsers =
    users.bots.length > 0 || users.roles.some((role) => role !== "classifier") || fallsBack;
  if (classifierRole && chatUsers) {
    throw Boom.badRequest("Move the classifier role to another classifier model first.");
  }
  if (classifierRole && target.type !== "classifier") {
    throw Boom.badRequest("The classifier role needs a classifier model.");
  }
  if (chatUsers && target.type !== "chat") throw Boom.badRequest("Move them to a chat model.");
  if (fallsBack && (await accountOrThrow(target.providerId)).kind === "claude-plan") {
    throw Boom.badRequest("The fallback must be a chat model that runs on pi.");
  }
  await db
    .update(bots)
    .set({ modelId: moveTo })
    .where(inArray(bots.modelId, [...from]));
  await db
    .update(modelRoles)
    .set({ modelId: moveTo })
    .where(inArray(modelRoles.modelId, [...from]));
  if (fallsBack && plan) {
    const settings = parseObject(plan.settingsJson);
    settings.fallbackModelId = moveTo;
    await db
      .update(providers)
      .set({ settingsJson: JSON.stringify(settings) })
      .where(eq(providers.id, plan.id));
  }
}

export async function deleteAccount(id: string, moveTo: string | undefined): Promise<Deleted> {
  const [row, routes] = await Promise.all([
    accountOrThrow(id),
    db.select({ id: providers.id }).from(providers).where(eq(providers.viaProviderId, id)),
  ]);
  if (routes.length > 0) {
    throw Boom.conflict("Accounts route through this gateway. Delete them first.");
  }
  const ids = (
    await db.select({ id: models.id }).from(models).where(eq(models.providerId, id))
  ).map((m) => m.id);
  await moveOrRefuse(ids, moveTo);
  await db.delete(providers).where(eq(providers.id, id));
  if (row.credentialItemId) await removeKey(row.credentialItemId);
  await reloadModels();
  return { deleted: true };
}

export async function addModel(
  providerId: string,
  input: {
    upstreamId: string;
    name?: string;
    overrides: Overrides;
    compat?: Record<string, unknown> | null;
  },
): Promise<AccountModel> {
  const [row, existing] = await Promise.all([
    accountOrThrow(providerId),
    db.query.models.findFirst({
      where: and(eq(models.providerId, providerId), eq(models.upstreamId, input.upstreamId)),
    }),
  ]);
  if (existing) throw Boom.conflict("The account already has that model.");
  const kind = row.kind as Kind;
  const found =
    kind === "cloudflare-ai-gateway" && !row.viaProviderId
      ? ((
          await discoverAt({
            kind,
            baseUrl: row.baseUrl,
            allowPrivateNetwork: false,
          })
        ).find((m) => m.upstreamId === input.upstreamId) ??
        resolveCapabilities(kind, row.baseUrl, input.upstreamId))
      : resolveCapabilities(kind, row.baseUrl, input.upstreamId, input.name);
  const [created] = await db
    .insert(models)
    .values(
      modelValues(providerId, { ...found, ...(input.name ? { name: input.name } : {}) }, "manual", {
        overrides: input.overrides,
        ...(input.compat !== undefined ? { compat: input.compat } : {}),
      }),
    )
    .onConflictDoNothing({ target: [models.providerId, models.upstreamId] })
    .returning();
  if (!created) throw Boom.conflict("The account already has that model.");
  await reloadModels();
  return modelView(created, 0);
}

export async function patchModel(
  id: string,
  input: {
    name?: string;
    enabled?: boolean;
    overrides?: Overrides;
    compat?: Record<string, unknown> | null;
  },
): Promise<AccountModel> {
  const row = await modelOrThrow(id);
  const account = await accountOrThrow(row.providerId);
  let capabilities = {};
  if (input.overrides) {
    const base = resolveCapabilities(account.kind as Kind, account.baseUrl, row.upstreamId);
    capabilities = {
      contextWindow: input.overrides.contextWindow ?? base.contextWindow,
      maxOutputTokens: input.overrides.maxOutputTokens ?? base.maxOutputTokens,
      imageInput: input.overrides.imageInput ?? base.imageInput,
      reasoning: input.overrides.reasoning ?? base.reasoning,
      overridesJson: JSON.stringify(input.overrides),
    };
  }
  const [updated] = await db
    .update(models)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.compat !== undefined
        ? { compatJson: input.compat ? JSON.stringify(input.compat) : null }
        : {}),
      ...capabilities,
    })
    .where(eq(models.id, id))
    .returning();
  await reloadModels();
  return modelView(updated!, (await botUsage()).get(id) ?? 0);
}

export async function deleteModel(id: string, moveTo: string | undefined): Promise<Deleted> {
  await modelOrThrow(id);
  await moveOrRefuse([id], moveTo);
  await db.delete(models).where(eq(models.id, id));
  await reloadModels();
  return { deleted: true };
}
