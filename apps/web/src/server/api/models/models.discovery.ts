import {
  discoverModels,
  gatewayCustomBaseUrl,
  resolveCapabilities,
  type DiscoveredModel,
} from "@tiny-agents/models";
import { listClaudeCodeModels } from "@tiny-agents/agent/claude-worker";
import { sharedClaudeWorkerLocator } from "../sandbox/claude-worker";
import { guardedGet } from "./models.fetch";
import type { DiscoverDTO } from "./models.schema";
import type { DiscoveredModels } from "../../../shared/api/models";
import { accountOrThrow, parseObject, storedKey } from "./models.records";
import { canonicalEndpoint, outbound, refuseClaudeToken, type Endpoint } from "./models.endpoint";

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

export async function discoverAt(input: Endpoint): Promise<DiscoveredModel[]> {
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

export async function discoverNew(input: Endpoint): Promise<DiscoveredModel[]> {
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
        guardedGet(url, headers, {
          allowPrivateNetwork: input.allowPrivateNetwork,
        }),
    });
  } catch (error) {
    outbound(error);
  }
}

export async function discover(input: DiscoverDTO): Promise<DiscoveredModels> {
  refuseClaudeToken(input.apiKey);
  const found = await discoverNew({
    ...input,
    kind: input.kind,
    baseUrl: input.baseUrl ?? null,
  });
  return { models: found };
}
