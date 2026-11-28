import { Boom } from "@groot/core/errors";
import { secretRedactor, SecretValue } from "@tiny-agents/agent";
import {
  testClassifierCall,
  testModelCall,
  testUnsavedModel,
  type ProviderAccount,
  type TestResult,
  resolveCapabilities,
} from "@tiny-agents/models";
import { eq } from "drizzle-orm";
import { db, providers } from "../../db";
import { getAgentRuntime } from "../bots/bots.runtime";
import { checkResolvesPublic, guardedFetch } from "./models.fetch";
import type { CreateAccountDTO, TestDTO } from "./models.schema";
import { accountOrThrow, parseObject, storedKey } from "./models.records";
import { canonicalEndpoint, outbound, refuseClaudeToken, settingsFor } from "./models.endpoint";

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
  const baseUrl = canonicalEndpoint({
    ...input,
    kind,
    baseUrl: input.baseUrl ?? null,
  });
  const target = via?.baseUrl ?? baseUrl ?? (via ? "https://gateway.ai.cloudflare.com" : null);
  if (target) {
    try {
      await checkResolvesPublic(target, input.allowPrivateNetwork);
    } catch (error) {
      outbound(error);
    }
  }
  const gatewayKey = via ? await storedKey(via) : undefined;
  const settings = settingsFor({
    ...input,
    discovery: "manual",
    models: [],
  } as CreateAccountDTO);
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
        account("test", {
          hasCredential: false,
          viaProviderId: "gateway",
          baseUrl: null,
        }),
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
        guardedFetch(input2, init ?? {}, {
          allowPrivateNetwork: input.allowPrivateNetwork,
        }),
    },
  );
  return redacted(result, input.upstreamId);
}
