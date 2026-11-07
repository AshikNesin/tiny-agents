/**
 * Settings → Models (issue #179): the owner's provider accounts, their models
 * and the model roles. Every write commits, then `reloadModels()` hands the
 * runtime the new snapshot and tells the pickers. No response carries a key:
 * keys go straight into an `app` vault item and come back as a hint.
 */
import { randomBytes } from "node:crypto";
import { and, count, eq, inArray, isNotNull } from "drizzle-orm";
import { Boom, HttpError } from "@groot/core/errors";
import {
  discoverModels,
  DiscoveryError,
  secretRedactor,
  SecretValue,
  testModelCall,
  testUnsavedModel,
  type ProviderAccount,
  type TestResult,
  PROVIDER_KINDS,
  PROVIDER_TEMPLATES,
  resolveCapabilities,
  type DiscoveredModel,
  type ProviderKind,
} from "@tiny-agents/agent";
import {
  bots,
  db,
  modelRoles,
  models,
  providers,
  vaultItems,
  type ModelRowRecord,
  type ProviderRow,
} from "../../db";
import { fauxMode } from "../../env";
import { createAppCredential, deleteItemRow } from "../vault/vault.admin.service";
import { getAgentRuntime } from "../bots/bots.runtime";
import { providerHost, reloadModels, vaultCredentials } from "./models.config";
import {
  checkBaseUrl,
  checkResolvesPublic,
  guardedGet,
  OutboundRefusedError,
} from "./models.fetch";
import type {
  CreateAccountDTO,
  DiscoverDTO,
  Overrides,
  TestDTO,
  UpdateConnectionDTO,
} from "./models.schema";
import { ROLES } from "./models.schema";

type Kind = Exclude<ProviderKind, "faux">;

/** Workers AI's REST host: where a gateway account's classifier calls go. */
const WORKERS_AI_HOST = "api.cloudflare.com";

/** How each kind sends its key (the vault item's injection). */
const INJECT: Record<Exclude<Kind, "claude-plan">, { name: string; format: string }> = {
  anthropic: { name: "x-api-key", format: "{value}" },
  "openai-chat": { name: "Authorization", format: "Bearer {value}" },
  "openai-responses": { name: "Authorization", format: "Bearer {value}" },
  gemini: { name: "x-goog-api-key", format: "{value}" },
  "cloudflare-ai-gateway": { name: "cf-aig-authorization", format: "Bearer {value}" },
};

const parseObject = (raw: string | null | undefined): Record<string, unknown> => {
  try {
    const value = JSON.parse(raw ?? "{}") as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
};

/** "sk-…a1B2": enough to tell keys apart, never enough to use one. */
function keyHint(key: string): string {
  const tail = key.slice(-4);
  const head = key.match(/^[A-Za-z]+[-_]/)?.[0] ?? "";
  return `${head}…${tail}`;
}

/** A Claude.ai OAuth token is never stored (ADR 0008): the Claude plan signs in on the sandbox. */
function refuseClaudeToken(key: string | undefined): void {
  if (key?.includes("sk-ant-oat")) {
    throw Boom.badRequest(
      "That is a Claude.ai sign-in token. tiny-agents never stores it: add a Claude plan account instead.",
    );
  }
}

function outbound(error: unknown): never {
  if (error instanceof OutboundRefusedError) throw Boom.badRequest(error.message);
  if (error instanceof DiscoveryError) {
    throw Boom.badRequest(error.message, undefined, error.code);
  }
  throw error;
}

// ── Reading ─────────────────────────────────────────────────────────────

function modelView(row: ModelRowRecord, usedBy: number) {
  return {
    id: row.id,
    upstreamId: row.upstreamId,
    name: row.name,
    type: row.type,
    source: row.source,
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

async function accountView(row: ProviderRow, usage: Map<string, number>) {
  const rows = await db.select().from(models).where(eq(models.providerId, row.id));
  const item = row.credentialItemId
    ? await db.query.vaultItems.findFirst({
        where: eq(vaultItems.id, row.credentialItemId),
        columns: { backend: true },
      })
    : undefined;
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as ProviderKind,
    baseUrl: row.baseUrl,
    viaProviderId: row.viaProviderId,
    settings: parseObject(row.settingsJson),
    discovery: row.discovery,
    allowPrivateNetwork: row.allowPrivateNetwork,
    enabled: row.enabled,
    status: row.status,
    statusDetail: row.statusDetail,
    checkedAt: row.checkedAt,
    version: row.version,
    credential: item ? { hint: row.credentialHint, backend: item.backend } : null,
    models: rows
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((model) => modelView(model, usage.get(model.id) ?? 0)),
  };
}

/** Bots per model id. */
async function botUsage(): Promise<Map<string, number>> {
  const rows = await db
    .select({ modelId: bots.modelId, n: count() })
    .from(bots)
    .where(isNotNull(bots.modelId))
    .groupBy(bots.modelId);
  return new Map(rows.map((row) => [row.modelId!, row.n]));
}

export async function listAccounts() {
  const usage = await botUsage();
  const rows = await db.select().from(providers);
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

async function accountOrThrow(id: string): Promise<ProviderRow> {
  const row = await db.query.providers.findFirst({ where: eq(providers.id, id) });
  if (!row) throw Boom.notFound("No such provider account");
  return row;
}

async function modelOrThrow(id: string): Promise<ModelRowRecord> {
  const row = await db.query.models.findFirst({ where: eq(models.id, id) });
  if (!row) throw Boom.notFound("No such model");
  return row;
}

// ── Discovery ───────────────────────────────────────────────────────────

interface Endpoint {
  kind: Kind;
  baseUrl: string | null;
  apiKey?: string;
  allowPrivateNetwork: boolean;
  viaProviderId?: string | null;
}

/** The canonical endpoint of a new or edited account; throws 400 with what to fix. */
function canonicalEndpoint(input: Endpoint): string | null {
  if (input.kind === "claude-plan" || input.viaProviderId) return null;
  if (input.kind === "cloudflare-ai-gateway") {
    return input.baseUrl ? checkBaseUrl(input.baseUrl, false) : null;
  }
  const base = input.baseUrl ?? PROVIDER_KINDS[input.kind].defaultBaseUrl ?? null;
  if (!base) throw Boom.badRequest("Set the endpoint.");
  try {
    return checkBaseUrl(base, input.allowPrivateNetwork);
  } catch (error) {
    outbound(error);
  }
}

async function discoverAt(input: Endpoint): Promise<DiscoveredModel[]> {
  // A gateway route lists nothing itself: the owner adds models by id.
  if (input.viaProviderId) return [];
  const baseUrl = canonicalEndpoint(input);
  try {
    return await discoverModels({
      kind: input.kind,
      baseUrl,
      ...(input.apiKey ? { apiKey: input.apiKey } : {}),
      get: (url, headers) =>
        guardedGet(url, headers, { allowPrivateNetwork: input.allowPrivateNetwork }),
    });
  } catch (error) {
    outbound(error);
  }
}

/** Discover without saving (the dialog's "Check models"). */
export async function discover(input: DiscoverDTO) {
  refuseClaudeToken(input.apiKey);
  const found = await discoverAt({ ...input, kind: input.kind, baseUrl: input.baseUrl ?? null });
  return { models: found };
}

// ── Accounts ────────────────────────────────────────────────────────────

/** The `app` vault item holding an account's key, for its endpoint's hosts. */
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

function settingsFor(input: CreateAccountDTO): Record<string, unknown> {
  const s = input.settings;
  switch (input.kind) {
    case "cloudflare-ai-gateway":
      if (!s.accountId || !s.gatewayId) {
        throw Boom.badRequest("A gateway account needs its Account ID and Gateway ID.");
      }
      return { accountId: s.accountId, gatewayId: s.gatewayId };
    case "claude-plan":
      return s.fallbackModelId ? { fallbackModelId: s.fallbackModelId } : {};
    default:
      if (input.viaProviderId) {
        if (!s.upstream) throw Boom.badRequest("Name the gateway's upstream provider.");
        return { upstream: s.upstream, ...(s.basePath ? { basePath: s.basePath } : {}) };
      }
      return {};
  }
}

export async function createAccount(input: CreateAccountDTO) {
  refuseClaudeToken(input.apiKey);
  const kind = input.kind;
  if (kind === "claude-plan") {
    const existing = await db.query.providers.findFirst({ where: eq(providers.kind, kind) });
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
  const baseUrl = canonicalEndpoint({ ...input, kind, baseUrl: input.baseUrl ?? null });
  const keyNeeded =
    kind !== "claude-plan" &&
    !input.viaProviderId &&
    !PROVIDER_TEMPLATES.some((t) => t.keyless && t.baseUrl === baseUrl) &&
    !input.allowPrivateNetwork;
  if (keyNeeded && !input.apiKey) throw Boom.badRequest("Enter the API key.");

  // Discover again with what will be saved, so the stored models are real.
  const found =
    input.discovery === "auto"
      ? await discoverAt({ ...input, kind, baseUrl })
      : input.model
        ? [
            resolveCapabilities(
              kind,
              baseUrl,
              input.model.upstreamId,
              input.model.name ?? input.model.upstreamId,
            ),
          ]
        : [];
  const chosen =
    input.discovery === "auto" ? found.filter((m) => input.models.includes(m.upstreamId)) : found;
  if (input.discovery === "manual" && !input.model) throw Boom.badRequest("Add a model.");

  const name =
    input.name ??
    PROVIDER_TEMPLATES.find((t) => t.kind === kind && t.baseUrl === baseUrl)?.label ??
    (baseUrl ? new URL(baseUrl).host : PROVIDER_KINDS[kind].label);
  const item = input.apiKey ? await storeKey(kind, name, baseUrl, input.apiKey) : undefined;
  const [row] = await db
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
    .returning();
  const account = row!;
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
  input: { name?: string; enabled?: boolean; fallbackModelId?: string | null },
  ifMatch: number | undefined,
) {
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

/** The stored key, for discovery and Test with the account as saved. */
async function storedKey(row: ProviderRow): Promise<string | undefined> {
  if (!row.credentialItemId) return undefined;
  const key = await vaultCredentials.resolve(row.id);
  if (!key) throw Boom.badRequest("The saved key can't be read. Re-enter it.");
  return key;
}

/** Mark rows the endpoint no longer lists, and clear the mark on the ones it does. */
async function markListed(providerId: string, found: readonly DiscoveredModel[]) {
  const listed = new Set(found.map((m) => m.upstreamId));
  const rows = await db.select().from(models).where(eq(models.providerId, providerId));
  for (const row of rows) {
    const missing = !listed.has(row.upstreamId);
    if (missing === (row.missingSince !== null)) continue;
    await db
      .update(models)
      .set({ missingSince: missing ? new Date() : null })
      .where(eq(models.id, row.id));
  }
}

export async function updateConnection(id: string, input: UpdateConnectionDTO) {
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
  // The key is bound to its host: a new origin needs a new key.
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
    .where(eq(providers.id, id))
    .returning();
  if (item && row.credentialItemId) await removeKey(row.credentialItemId);
  if (found) await markListed(id, found);
  await reloadModels();
  return accountView(updated!, await botUsage());
}

async function removeKey(itemId: string): Promise<void> {
  const item = await db.query.vaultItems.findFirst({ where: eq(vaultItems.id, itemId) });
  if (item) await deleteItemRow(item, { purge: true });
}

/** Discover again with the stored key: marks models the endpoint stopped listing. */
export async function refreshAccount(id: string) {
  const row = await accountOrThrow(id);
  const kind = row.kind as Kind;
  let found: DiscoveredModel[];
  const key = await storedKey(row);
  try {
    found = await discoverAt({
      kind,
      baseUrl: row.baseUrl,
      ...(key ? { apiKey: key } : {}),
      allowPrivateNetwork: row.allowPrivateNetwork,
      viaProviderId: row.viaProviderId,
    });
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
  await reloadModels();
  const have = new Set(
    (
      await db
        .select({ upstreamId: models.upstreamId })
        .from(models)
        .where(eq(models.providerId, id))
    ).map((m) => m.upstreamId),
  );
  return {
    account: await accountView(await accountOrThrow(id), await botUsage()),
    available: found.filter((m) => !have.has(m.upstreamId)),
  };
}

/** Who uses these models: bots, and roles (409 `in_use` unless they move). */
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

/** Move what uses `from` onto `moveTo`, or refuse with who uses it. */
async function moveOrRefuse(from: readonly string[], moveTo: string | undefined) {
  const users = await usage(from);
  // The Claude plan's fallback may point here too.
  const plan = await db.query.providers.findFirst({ where: eq(providers.kind, "claude-plan") });
  const fallback = parseObject(plan?.settingsJson).fallbackModelId;
  const fallsBack = typeof fallback === "string" && from.includes(fallback);
  if (users.bots.length === 0 && users.roles.length === 0 && !fallsBack) return;
  if (!moveTo) {
    throw Boom.conflict("In use", { in_use: { ...users, claudePlanFallback: fallsBack } });
  }
  if (from.includes(moveTo)) throw Boom.badRequest("Move them to another model.");
  const target = await modelOrThrow(moveTo);
  if (target.type !== "chat") throw Boom.badRequest("Move them to a chat model.");
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

export async function deleteAccount(id: string, moveTo: string | undefined) {
  const row = await accountOrThrow(id);
  const routes = await db
    .select({ id: providers.id })
    .from(providers)
    .where(eq(providers.viaProviderId, id));
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

// ── Models ──────────────────────────────────────────────────────────────

export async function addModel(
  providerId: string,
  input: {
    upstreamId: string;
    name?: string;
    overrides: Overrides;
    compat?: Record<string, unknown> | null;
  },
) {
  const row = await accountOrThrow(providerId);
  const existing = await db.query.models.findFirst({
    where: and(eq(models.providerId, providerId), eq(models.upstreamId, input.upstreamId)),
  });
  if (existing) throw Boom.conflict("The account already has that model.");
  const kind = row.kind as Kind;
  const found =
    kind === "cloudflare-ai-gateway" && !row.viaProviderId
      ? ((await discoverAt({ kind, baseUrl: row.baseUrl, allowPrivateNetwork: false })).find(
          (m) => m.upstreamId === input.upstreamId,
        ) ?? resolveCapabilities(kind, row.baseUrl, input.upstreamId))
      : resolveCapabilities(kind, row.baseUrl, input.upstreamId, input.name);
  const [created] = await db
    .insert(models)
    .values(
      modelValues(providerId, { ...found, ...(input.name ? { name: input.name } : {}) }, "manual", {
        overrides: input.overrides,
        ...(input.compat !== undefined ? { compat: input.compat } : {}),
      }),
    )
    .returning();
  await reloadModels();
  return modelView(created!, 0);
}

export async function patchModel(
  id: string,
  input: {
    name?: string;
    enabled?: boolean;
    overrides?: Overrides;
    compat?: Record<string, unknown> | null;
  },
) {
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

export async function deleteModel(id: string, moveTo: string | undefined) {
  await modelOrThrow(id);
  await moveOrRefuse([id], moveTo);
  await db.delete(models).where(eq(models.id, id));
  await reloadModels();
  return { deleted: true };
}

// ── Roles ───────────────────────────────────────────────────────────────

export async function getRoles() {
  const catalog = getAgentRuntime().catalog;
  return {
    roles: Object.fromEntries(
      ROLES.map((role) => {
        const model = catalog.forRole(role);
        return [
          role,
          {
            modelId: model?.id ?? null,
            fallback: !catalog.roleIsSet(role),
          },
        ];
      }),
    ),
  };
}

export async function putRoles(input: Partial<Record<(typeof ROLES)[number], string | null>>) {
  for (const [role, modelId] of Object.entries(input)) {
    if (modelId === null || modelId === undefined) {
      await db.delete(modelRoles).where(eq(modelRoles.role, role));
      continue;
    }
    const model = await modelOrThrow(modelId);
    const wantsClassifier = role === "classifier";
    if ((model.type === "classifier") !== wantsClassifier) {
      throw Boom.badRequest(
        wantsClassifier ? "The classifier role needs a classifier model." : "Pick a chat model.",
      );
    }
    await db
      .insert(modelRoles)
      .values({ role, modelId })
      .onConflictDoUpdate({ target: modelRoles.role, set: { modelId, updatedAt: new Date() } });
  }
  await reloadModels();
  return getRoles();
}

// ── Test ────────────────────────────────────────────────────────────────

/** A provider's error, cut and with any key scrubbed, before it reaches the UI. */
const redacted = (result: TestResult): TestResult =>
  result.error ? { ...result, error: secretRedactor.scrub(result.error).slice(0, 500) } : result;

/** One real, minimal completion: a saved model, or one of an unsaved account. */
export async function testModel(input: TestDTO): Promise<TestResult> {
  if ("modelId" in input) {
    const rt = getAgentRuntime();
    const model = rt.catalog.get(input.modelId);
    if (!model) throw Boom.notFound("No such model");
    if (model.engine === "claude-code") {
      const started = Date.now();
      const account = await rt.claudeCodeAccount();
      const ok = account.state === "ready" && account.loggedIn;
      return {
        ok,
        latencyMs: Date.now() - started,
        ...(ok
          ? {}
          : { error: "Claude Code is not signed in on the sandbox (Settings → Claude plan)." }),
      };
    }
    const pi = rt.catalog.piModel(input.modelId);
    if (!pi) {
      return {
        ok: false,
        latencyMs: 0,
        error: `The model can't run (${model.unavailableReason ?? "missing"}).`,
      };
    }
    return redacted(await testModelCall(rt.models, pi));
  }
  refuseClaudeToken(input.apiKey);
  if (input.kind === "claude-plan")
    throw Boom.badRequest("Test a Claude plan model once it is saved.");
  if (input.apiKey) secretRedactor.register(new SecretValue(input.apiKey));
  const kind = input.kind;
  const via = input.viaProviderId ? await accountOrThrow(input.viaProviderId) : undefined;
  const baseUrl = canonicalEndpoint({ ...input, kind, baseUrl: input.baseUrl ?? null });
  const target = via?.baseUrl ?? baseUrl ?? (via ? "https://gateway.ai.cloudflare.com" : null);
  if (target) {
    try {
      await checkResolvesPublic(target, input.allowPrivateNetwork);
    } catch (error) {
      outbound(error);
    }
  }
  const gatewayKey = via ? await storedKey(via) : undefined;
  const settings = settingsFor({ ...input, discovery: "manual", models: [] } as CreateAccountDTO);
  const account = (id: string, fields: Partial<ProviderAccount>): ProviderAccount => ({
    id,
    name: id,
    kind,
    baseUrl,
    hasCredential: Boolean(input.apiKey),
    viaProviderId: null,
    settings,
    enabled: true,
    status: "ok",
    statusDetail: null,
    ...fields,
  });
  const providersList: ProviderAccount[] = via
    ? [
        account("gateway", {
          kind: "cloudflare-ai-gateway",
          baseUrl: via.baseUrl,
          hasCredential: Boolean(gatewayKey),
          settings: parseObject(via.settingsJson),
        }),
        account("test", { hasCredential: false, viaProviderId: "gateway", baseUrl: null }),
      ]
    : [account("test", {})];
  const found = resolveCapabilities(kind, baseUrl, input.upstreamId);
  const result = await testUnsavedModel(
    {
      providers: providersList,
      models: [
        {
          id: "test-model",
          providerId: "test",
          upstreamId: input.upstreamId,
          name: input.upstreamId,
          type: "chat",
          enabled: true,
          contextWindow: found.contextWindow,
          maxOutputTokens: found.maxOutputTokens,
          imageInput: found.imageInput,
          reasoning: found.reasoning,
          compat: found.compat,
          missing: false,
        },
      ],
      roles: {},
    },
    { resolve: async (id) => (id === "gateway" ? gatewayKey : input.apiKey) },
    "test",
    input.upstreamId,
    { image: input.image },
  );
  return redacted(result);
}
