import { randomBytes } from "node:crypto";
import { and, count, eq, inArray, isNotNull } from "drizzle-orm";
import { Boom, HttpError } from "@groot/core/errors";
import { secretRedactor, SecretValue } from "@tiny-agents/agent";
import {
  discoverModels,
  DiscoveryError,
  gatewayCustomBaseUrl,
  type GatewayCustomProvider,
  testClassifierCall,
  testModelCall,
  testUnsavedModel,
  type ProviderAccount,
  type TestResult,
  PROVIDER_KINDS,
  PROVIDER_TEMPLATES,
  resolveCapabilities,
  type DiscoveredModel,
  type ProviderKind,
} from "@tiny-agents/models";
import { listClaudeCodeModels } from "@tiny-agents/agent/claude-worker";
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
import { sharedClaudeWorkerLocator } from "../bots/claude-worker";
import { providerHost, reloadModels, vaultCredentials } from "./models.config";
import {
  checkBaseUrl,
  checkResolvesPublic,
  guardedFetch,
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
import type { Deleted } from "../../../shared/api/common";
import type {
  AccountData,
  AccountListData,
  AccountModel,
  AccountRefreshData,
  DiscoveredModels,
  Roles,
  RolesResponse,
} from "../../../shared/api/models";

type Kind = Exclude<ProviderKind, "faux">;

const WORKERS_AI_HOST = "api.cloudflare.com";

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

function keyHint(key: string): string {
  const tail = key.slice(-4);
  const head = key.match(/^[A-Za-z]+[-_]/)?.[0] ?? "";
  return `${head}…${tail}`;
}

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

function modelView(row: ModelRowRecord, usedBy: number): AccountModel {
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

async function accountView(row: ProviderRow, usage: Map<string, number>): Promise<AccountData> {
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
    credential: item ? { hint: row.credentialHint, backend: item.backend } : null,
    models: rows
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((model) => modelView(model, usage.get(model.id) ?? 0)),
  };
}

async function botUsage(): Promise<Map<string, number>> {
  const rows = await db
    .select({ modelId: bots.modelId, n: count() })
    .from(bots)
    .where(isNotNull(bots.modelId))
    .groupBy(bots.modelId);
  return new Map(rows.map((row) => [row.modelId!, row.n]));
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

interface Endpoint {
  kind: Kind;
  baseUrl: string | null;
  apiKey?: string;
  allowPrivateNetwork: boolean;
  viaProviderId?: string | null;
  settings?: {
    accountId?: string;
    gatewayId?: string;
    customProviders?: GatewayCustomProvider[];
    upstream?: string;
    basePath?: string;
  };
}

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

async function discoverThroughGateway(input: Endpoint): Promise<DiscoveredModel[]> {
  const gateway = await accountOrThrow(input.viaProviderId!);
  const settings = parseObject(gateway.settingsJson);
  const upstream = input.settings?.upstream?.trim();
  if (
    !upstream ||
    typeof settings.accountId !== "string" ||
    typeof settings.gatewayId !== "string"
  ) {
    return [];
  }
  const basePath = input.settings?.basePath?.replace(/^\/+|\/+$/g, "");
  const routeBase = [
    (gateway.baseUrl ?? "https://gateway.ai.cloudflare.com").replace(/\/+$/, ""),
    "v1",
    settings.accountId,
    settings.gatewayId,
    upstream,
    ...(basePath ? [basePath] : []),
  ].join("/");
  const key = await storedKey(gateway);
  try {
    return await discoverModels({
      kind: "openai-chat",
      baseUrl: routeBase,
      headers: key ? { "cf-aig-authorization": `Bearer ${key}` } : {},
      get: (url, headers) => guardedGet(url, headers, { allowPrivateNetwork: false }),
    });
  } catch {
    return [];
  }
}

async function discoverCustomProviders(input: Endpoint): Promise<DiscoveredModel[]> {
  const { accountId, gatewayId } = input.settings ?? {};
  const custom = input.settings?.customProviders ?? [];
  if (!accountId || !gatewayId || custom.length === 0) return [];
  const frontDoor = input.baseUrl ?? "https://gateway.ai.cloudflare.com";
  const lists = await Promise.all(
    custom.map(async (provider) => {
      try {
        const listed = await discoverModels({
          kind: "openai-chat",
          baseUrl: gatewayCustomBaseUrl(frontDoor, { accountId, gatewayId }, provider),
          headers: input.apiKey ? { "cf-aig-authorization": `Bearer ${input.apiKey}` } : {},
          get: (url, headers) => guardedGet(url, headers, { allowPrivateNetwork: false }),
        });
        return listed.map((model) => {
          const resolved = resolveCapabilities(
            "cloudflare-ai-gateway",
            input.baseUrl,
            `${provider.slug}/${model.upstreamId}`,
          );
          const name = resolved.known ? resolved.name : model.name;
          return { ...resolved, name: `${name} (${provider.slug})` };
        });
      } catch {
        return [];
      }
    }),
  );
  return lists.flat();
}

async function discoverAt(input: Endpoint): Promise<DiscoveredModel[]> {
  if (input.viaProviderId) return discoverThroughGateway(input);
  if (input.kind === "cloudflare-ai-gateway") {
    const [custom, catalog] = await Promise.all([
      discoverCustomProviders(input),
      discoverDirect(input),
    ]);
    return [...custom, ...catalog];
  }
  return discoverDirect(input);
}

function claudePlanLister(): (() => ReturnType<typeof listClaudeCodeModels>) | undefined {
  const locator = sharedClaudeWorkerLocator();
  return locator ? () => listClaudeCodeModels(() => locator.resolve()) : undefined;
}

async function discoverNew(input: Endpoint): Promise<DiscoveredModel[]> {
  if (input.kind !== "claude-plan") return discoverAt(input);
  try {
    return await discoverAt(input);
  } catch {
    return [];
  }
}

async function discoverDirect(input: Endpoint): Promise<DiscoveredModel[]> {
  const baseUrl = canonicalEndpoint(input);
  const listClaudePlan = input.kind === "claude-plan" ? claudePlanLister() : undefined;
  try {
    return await discoverModels({
      kind: input.kind,
      baseUrl,
      ...(input.apiKey ? { apiKey: input.apiKey } : {}),
      ...(listClaudePlan ? { listClaudePlan } : {}),
      get: (url, headers) =>
        guardedGet(url, headers, { allowPrivateNetwork: input.allowPrivateNetwork }),
    });
  } catch (error) {
    outbound(error);
  }
}

export async function discover(input: DiscoverDTO): Promise<DiscoveredModels> {
  refuseClaudeToken(input.apiKey);
  const found = await discoverNew({ ...input, kind: input.kind, baseUrl: input.baseUrl ?? null });
  return { models: found };
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

function settingsFor(input: CreateAccountDTO): Record<string, unknown> {
  const s = input.settings;
  switch (input.kind) {
    case "cloudflare-ai-gateway": {
      if (!s.accountId || !s.gatewayId) {
        throw Boom.badRequest("A gateway account needs its Account ID and Gateway ID.");
      }
      const trimPath = (path?: string) => path?.replace(/^\/+|\/+$/g, "") || undefined;
      const custom = (s.customProviders ?? []).map((p) => {
        const basePath = trimPath(p.basePath);
        return { slug: p.slug, ...(basePath ? { basePath } : {}) };
      });
      return {
        accountId: s.accountId,
        gatewayId: s.gatewayId,
        ...(custom.length > 0 ? { customProviders: custom } : {}),
      };
    }
    case "claude-plan":
      return {
        ...(s.fallbackModelId ? { fallbackModelId: s.fallbackModelId } : {}),
        ...(s.maxTurns ? { maxTurns: s.maxTurns } : {}),
      };
    default:
      if (input.viaProviderId) {
        if (!s.upstream) throw Boom.badRequest("Name the gateway's upstream provider.");
        return { upstream: s.upstream, ...(s.basePath ? { basePath: s.basePath } : {}) };
      }
      return {};
  }
}

export async function createAccount(input: CreateAccountDTO): Promise<AccountData> {
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

async function storedKey(row: ProviderRow): Promise<string | undefined> {
  if (!row.credentialItemId) return undefined;
  const key = await vaultCredentials.resolve(row.id);
  if (!key) throw Boom.badRequest("The saved key can't be read. Re-enter it.");
  return key;
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
    const gone = await db.query.providers.findFirst({ where: eq(providers.id, id) });
    if (!gone) throw Boom.notFound("No such provider account");
    throw new HttpError(412, "The account changed meanwhile. Reload and try again.");
  }
  if (item && row.credentialItemId) await removeKey(row.credentialItemId);
  if (found) await markListed(id, found);
  await reloadModels();
  return accountView(updated!, await botUsage());
}

async function removeKey(itemId: string): Promise<void> {
  const item = await db.query.vaultItems.findFirst({ where: eq(vaultItems.id, itemId) });
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
    throw Boom.conflict("In use", { in_use: { ...users, claudePlanFallback: fallsBack } });
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

export async function getRoles(): Promise<RolesResponse> {
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
    ) as Roles,
  };
}

export async function putRoles(
  input: Partial<Record<(typeof ROLES)[number], string | null>>,
): Promise<RolesResponse> {
  const entries = Object.entries(input);
  const cleared = entries.filter(([, modelId]) => !modelId).map(([role]) => role);
  const set = entries.filter((entry): entry is [string, string] => Boolean(entry[1]));
  const targets = await Promise.all(set.map(([, modelId]) => modelOrThrow(modelId)));
  set.forEach(([role], index) => {
    const wantsClassifier = role === "classifier";
    if ((targets[index]!.type === "classifier") !== wantsClassifier) {
      throw Boom.badRequest(
        wantsClassifier ? "The classifier role needs a classifier model." : "Pick a chat model.",
      );
    }
  });
  if (cleared.length > 0) await db.delete(modelRoles).where(inArray(modelRoles.role, cleared));
  await Promise.all(
    set.map(([role, modelId]) =>
      db
        .insert(modelRoles)
        .values({ role, modelId })
        .onConflictDoUpdate({ target: modelRoles.role, set: { modelId, updatedAt: new Date() } }),
    ),
  );
  await reloadModels();
  return getRoles();
}

const redacted = (result: TestResult, upstreamId?: string): TestResult =>
  result.error
    ? {
        ...result,
        error: explained(secretRedactor.scrub(result.error), upstreamId).slice(0, 600),
      }
    : result;

function explained(error: string, upstreamId?: string): string {
  const slug = upstreamId?.startsWith("custom-") ? upstreamId.split("/")[0] : undefined;
  if (slug && /^404\b/.test(error)) {
    return `${slug} answered 404 Not Found: the gateway reached it on the wrong path. Set its base path in this card's Custom providers (for Z.AI's coding plan: api/coding/paas/v4).`;
  }
  if (/"code":\s*2021|unified billing credits/i.test(error)) {
    return `The gateway has no key for this provider and no Unified Billing credits: add the provider's key to the gateway (BYOK), or credits in Cloudflare. ${error}`;
  }
  if (/"internalCode":\s*5035|not available on the Workers Free plan/i.test(error)) {
    return `This Workers AI model needs the Workers Paid plan. ${error}`;
  }
  return error;
}

async function accountAllowsPrivateNetwork(providerId: string): Promise<boolean> {
  const row = await db.query.providers.findFirst({
    where: eq(providers.id, providerId),
    columns: { allowPrivateNetwork: true },
  });
  if (row) return row.allowPrivateNetwork;
  const via = await db.query.providers.findFirst({
    where: eq(providers.id, providerId.split(":")[0] ?? providerId),
    columns: { allowPrivateNetwork: true },
  });
  return via?.allowPrivateNetwork ?? false;
}

export async function testModel(input: TestDTO): Promise<TestResult> {
  if ("modelId" in input) {
    const rt = getAgentRuntime();
    const model = rt.catalog.get(input.modelId);
    if (!model) throw Boom.notFound("No such model");
    if (model.engine === "claude-code") {
      const started = Date.now();
      const account = await rt.claudePlan.account();
      const ok = account.state === "ready" && account.loggedIn;
      return {
        ok,
        latencyMs: Date.now() - started,
        ...(ok
          ? {}
          : {
              error:
                "Claude Code is not signed in on the sandbox (Settings → Models → Claude plan).",
            }),
      };
    }
    if (model.type === "classifier") {
      const classifier = rt.catalog.classifierModel(input.modelId);
      if (!classifier) {
        return {
          ok: false,
          latencyMs: 0,
          error: `The model can't run (${model.unavailableReason ?? "missing"}).`,
        };
      }
      return redacted(await testClassifierCall(rt.models, classifier));
    }
    const pi = rt.catalog.piModel(input.modelId);
    if (!pi) {
      return {
        ok: false,
        latencyMs: 0,
        error: `The model can't run (${model.unavailableReason ?? "missing"}).`,
      };
    }
    const allowPrivateNetwork = await accountAllowsPrivateNetwork(pi.provider);
    return redacted(
      await testModelCall(rt.models, pi, {
        fetch: (input2, init) => guardedFetch(input2, init ?? {}, { allowPrivateNetwork }),
      }),
      model.upstreamId,
    );
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
    {
      image: input.image,
      fetch: (input2, init) =>
        guardedFetch(input2, init ?? {}, { allowPrivateNetwork: input.allowPrivateNetwork }),
    },
  );
  return redacted(result, input.upstreamId);
}
