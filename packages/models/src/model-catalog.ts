import type { Api, ClassifierApi, ClassifierModel, Model } from "@earendil-works/pi-ai";
import type { Models } from "@earendil-works/pi-ai/models";
import type { ModelConfig, ModelRow, ProviderAccount } from "./config";
import { CLAUDE_PLAN_NOTE, classifierProviderId, gatewayModelRoute, PROVIDER_KINDS } from "./kinds";
import type {
  CatalogModel,
  ModelRole,
  ModelRoute,
  ModelUnavailableReason,
  ProviderSummary,
} from "./types";

export type CatalogModels = Pick<Models, "getModel" | "getModelOfType">;

export interface ModelCatalog {
  list(filter?: { type?: CatalogModel["type"]; enabledOnly?: boolean }): CatalogModel[];
  get(id: string): CatalogModel | undefined;
  route(id: string): ModelRoute | undefined;
  piModel(id: string): Model<Api> | undefined;
  classifierModel(id: string): ClassifierModel<ClassifierApi> | undefined;
  forRole(role: ModelRole, options?: { bot?: string }): CatalogModel | undefined;
  roleIsSet(role: ModelRole): boolean;
  providers(): ProviderSummary[];
  claudePlan():
    | { enabled: boolean; fallbackModelId?: string; maxTurns?: number | "unlimited" }
    | undefined;
  canAnswer(): boolean;
}

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name);

function unavailableReason(
  account: ProviderAccount | undefined,
  row: ModelRow,
): ModelUnavailableReason | undefined {
  if (!account || !account.enabled) return "disabled";
  if (account.status === "locked") return "locked";
  if (account.status === "key_rejected" || account.status === "unreachable") {
    return "provider_failing";
  }
  if (row.missing) return "missing";
  return undefined;
}

export function createModelCatalog(config: ModelConfig, registry: CatalogModels): ModelCatalog {
  const accounts = new Map(config.providers.map((account) => [account.id, account]));
  const toModel = (row: ModelRow): CatalogModel => {
    const account = accounts.get(row.providerId);
    const kind = account?.kind ?? "openai-chat";
    const reason = unavailableReason(account, row);
    return {
      id: row.id,
      name: row.name,
      providerId: row.providerId,
      providerName: account?.name ?? row.providerId,
      providerKind: kind,
      upstreamId: row.upstreamId,
      type: row.type,
      engine: PROVIDER_KINDS[kind].engine,
      contextWindow: row.contextWindow,
      maxOutputTokens: row.maxOutputTokens,
      vision: row.imageInput,
      reasoning: row.reasoning,
      enabled: row.enabled,
      available: reason === undefined,
      ...(reason ? { unavailableReason: reason } : {}),
      ...(kind === "claude-plan" ? { note: CLAUDE_PLAN_NOTE } : {}),
    };
  };
  const sortedAccounts = [...config.providers].sort(byName);
  const all = sortedAccounts.flatMap((account) =>
    config.models
      .filter((row) => row.providerId === account.id)
      .map(toModel)
      .sort(byName),
  );
  const byId = new Map(all.map((model) => [model.id, model]));

  const route = (id: string): ModelRoute | undefined => {
    const model = byId.get(id);
    if (!model?.available) return undefined;
    if (model.type === "classifier") {
      return {
        engine: model.engine,
        providerId: classifierProviderId(model.providerId),
        upstreamId: model.upstreamId,
      };
    }
    const account = accounts.get(model.providerId);
    const target =
      account?.kind === "cloudflare-ai-gateway"
        ? gatewayModelRoute(account, model.upstreamId)
        : { providerId: model.providerId, upstreamId: model.upstreamId };
    return { engine: model.engine, ...target };
  };
  const usable = (id: string | undefined, type: CatalogModel["type"] = "chat") => {
    const model = id ? byId.get(id) : undefined;
    return model?.available && model.type === type ? model : undefined;
  };
  const firstChat = (predicate: (model: CatalogModel) => boolean = () => true) =>
    all.find((m) => m.type === "chat" && m.enabled && m.available && predicate(m));

  const catalog: ModelCatalog = {
    list(filter = {}) {
      return all.filter(
        (model) =>
          (!filter.type || model.type === filter.type) && (!filter.enabledOnly || model.enabled),
      );
    },
    get: (id) => byId.get(id),
    route,
    piModel(id) {
      const r = route(id);
      return r?.engine === "pi" && byId.get(id)?.type === "chat"
        ? registry.getModel(r.providerId, r.upstreamId)
        : undefined;
    },
    classifierModel(id) {
      const r = route(id);
      return r && byId.get(id)?.type === "classifier"
        ? (registry.getModelOfType("classifier", r.providerId, r.upstreamId) as
            | ClassifierModel<ClassifierApi>
            | undefined)
        : undefined;
    },
    forRole(role, options = {}) {
      const set = config.roles[role];
      switch (role) {
        case "bot_default":
          return usable(set) ?? firstChat();
        case "memory_capture":
        case "chat_title": {
          const pi = (model: CatalogModel | undefined) =>
            model?.engine === "pi" ? model : undefined;
          return (
            usable(set) ??
            pi(usable(options.bot)) ??
            pi(catalog.forRole("bot_default")) ??
            firstChat((m) => m.engine === "pi")
          );
        }
        case "vision":
          return usable(set) ?? firstChat((m) => m.vision && m.engine === "pi");
        case "classifier":
          return usable(set, "classifier");
      }
    },
    roleIsSet: (role) =>
      usable(config.roles[role], role === "classifier" ? "classifier" : "chat") !== undefined,
    providers() {
      return sortedAccounts.map((account) => ({
        id: account.id,
        name: account.name,
        kind: account.kind,
        status: account.status,
        ...(account.statusDetail ? { statusDetail: account.statusDetail } : {}),
        enabled: account.enabled,
        modelCount: config.models.filter((row) => row.providerId === account.id).length,
      }));
    },
    claudePlan() {
      const account = config.providers.find((p) => p.kind === "claude-plan");
      if (!account) return undefined;
      const fallback = account.settings.fallbackModelId;
      const maxTurns = account.settings.maxTurns;
      return {
        enabled: account.enabled,
        ...(typeof fallback === "string" && fallback ? { fallbackModelId: fallback } : {}),
        ...(maxTurns === "unlimited" ||
        (typeof maxTurns === "number" && Number.isInteger(maxTurns) && maxTurns > 0)
          ? { maxTurns }
          : {}),
      };
    },
    canAnswer: () => firstChat() !== undefined,
  };
  return catalog;
}
