import { Boom } from "@groot/core/errors";
import {
  DiscoveryError,
  type GatewayCustomProvider,
  PROVIDER_KINDS,
  type ProviderKind,
} from "@tiny-agents/models";
import { checkBaseUrl, OutboundRefusedError } from "./models.fetch";
import type { CreateAccountDTO } from "./models.schema";

export type Kind = Exclude<ProviderKind, "faux">;

export function refuseClaudeToken(key: string | undefined): void {
  if (key?.includes("sk-ant-oat")) {
    throw Boom.badRequest(
      "That is a Claude.ai sign-in token. tiny-agents never stores it: add a Claude plan account instead.",
    );
  }
}

export function outbound(error: unknown): never {
  if (error instanceof OutboundRefusedError) throw Boom.badRequest(error.message);
  if (error instanceof DiscoveryError) {
    throw Boom.badRequest(error.message, undefined, error.code);
  }
  throw error;
}

export interface Endpoint {
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

export function canonicalEndpoint(input: Endpoint): string | null {
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

export function settingsFor(input: CreateAccountDTO): Record<string, unknown> {
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
        return {
          upstream: s.upstream,
          ...(s.basePath ? { basePath: s.basePath } : {}),
        };
      }
      return {};
  }
}
