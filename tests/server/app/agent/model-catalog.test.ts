/**
 * The Model catalog as a projection of the owner's accounts and model rows
 * (issue #179): availability, routing, roles and their fallbacks, and the
 * pi-ai providers each kind builds.
 */
import { createModels } from "@earendil-works/pi-ai/models";
import { describe, expect, it } from "vite-plus/test";
import { createModelCatalog } from "../../../../packages/agent/src/model-catalog";
import type {
  ModelConfig,
  ModelRow,
  ProviderAccount,
} from "../../../../packages/agent/src/providers/config";
import {
  buildProviders,
  classifierProviderId,
} from "../../../../packages/agent/src/providers/kinds";

const account = (overrides: Partial<ProviderAccount> & Pick<ProviderAccount, "id" | "kind">) =>
  ({
    name: overrides.id,
    baseUrl: null,
    hasCredential: true,
    viaProviderId: null,
    settings: {},
    enabled: true,
    status: "ok",
    statusDetail: null,
    ...overrides,
  }) satisfies ProviderAccount;

const row = (overrides: Partial<ModelRow> & Pick<ModelRow, "id" | "providerId">): ModelRow => ({
  upstreamId: overrides.id,
  name: overrides.id,
  type: "chat",
  enabled: true,
  contextWindow: 100_000,
  maxOutputTokens: 8_000,
  imageInput: false,
  reasoning: false,
  compat: null,
  missing: false,
  ...overrides,
});

const credentials = { resolve: async (id: string) => `key-${id}` };

function catalogOf(config: ModelConfig) {
  const models = createModels();
  for (const provider of buildProviders(config, credentials)) models.setProvider(provider);
  return { catalog: createModelCatalog(config, models), models };
}

const base: ModelConfig = {
  providers: [
    account({ id: "anth", name: "Anthropic · Work", kind: "anthropic" }),
    account({ id: "oai", name: "OpenAI", kind: "openai-responses" }),
    account({ id: "plan", name: "Claude plan", kind: "claude-plan", hasCredential: false }),
  ],
  models: [
    row({ id: "sonnet", providerId: "anth", upstreamId: "claude-sonnet-4-6", imageInput: true }),
    row({ id: "gpt", providerId: "oai", upstreamId: "gpt-5" }),
    row({ id: "gpt-old", providerId: "oai", upstreamId: "gpt-4", missing: true }),
    row({ id: "plan-sonnet", providerId: "plan", upstreamId: "claude-sonnet-4-6" }),
  ],
  roles: {},
};

describe("Model catalog", () => {
  it("lists models by account name and routes each to its account's pi provider", () => {
    const { catalog } = catalogOf(base);
    expect(catalog.list().map((m) => m.id)).toEqual(["sonnet", "plan-sonnet", "gpt", "gpt-old"]);
    expect(catalog.get("sonnet")).toMatchObject({
      providerName: "Anthropic · Work",
      providerKind: "anthropic",
      engine: "pi",
      vision: true,
      available: true,
    });
    expect(catalog.route("gpt")).toEqual({ engine: "pi", providerId: "oai", upstreamId: "gpt-5" });
    expect(catalog.piModel("sonnet")).toMatchObject({
      id: "claude-sonnet-4-6",
      provider: "anth",
      api: "anthropic-messages",
      baseUrl: "https://api.anthropic.com",
      input: ["text", "image"],
    });
  });

  it("takes the engine from the provider kind: a Claude plan model runs on claude-code", () => {
    const { catalog } = catalogOf(base);
    expect(catalog.get("plan-sonnet")).toMatchObject({
      engine: "claude-code",
      note: "uses your Claude plan",
    });
    expect(catalog.route("plan-sonnet")).toMatchObject({ engine: "claude-code" });
    // Not a pi model: nothing pi-ai serves for it.
    expect(catalog.piModel("plan-sonnet")).toBeUndefined();
    expect(catalog.claudePlan()).toEqual({ enabled: true });
  });

  it("says why a model can't run, and routes nothing for it", () => {
    const { catalog } = catalogOf({
      ...base,
      providers: base.providers.map((p) =>
        p.id === "anth"
          ? { ...p, status: "locked" as const }
          : p.id === "oai"
            ? { ...p, enabled: false }
            : p,
      ),
    });
    expect(catalog.get("sonnet")).toMatchObject({ available: false, unavailableReason: "locked" });
    expect(catalog.get("gpt")).toMatchObject({ unavailableReason: "disabled" });
    expect(catalog.route("sonnet")).toBeUndefined();
    expect(catalogOf(base).catalog.get("gpt-old")).toMatchObject({ unavailableReason: "missing" });
  });

  it("resolves roles with their documented fallbacks", () => {
    const { catalog } = catalogOf(base);
    // Unset: the first available chat model; vision: the first that sees images.
    expect(catalog.forRole("bot_default")?.id).toBe("sonnet");
    expect(catalog.forRole("vision")?.id).toBe("sonnet");
    // Titles and capture: the bot's model when it runs on pi, else bot_default.
    expect(catalog.forRole("chat_title", { bot: "gpt" })?.id).toBe("gpt");
    expect(catalog.forRole("memory_capture", { bot: "plan-sonnet" })?.id).toBe("sonnet");
    // No classifier unless one is set.
    expect(catalog.forRole("classifier")).toBeUndefined();

    const set = catalogOf({ ...base, roles: { bot_default: "gpt", chat_title: "gpt" } }).catalog;
    expect(set.forRole("bot_default")?.id).toBe("gpt");
    expect(set.forRole("chat_title", { bot: "sonnet" })?.id).toBe("gpt");
    expect(set.roleIsSet("chat_title")).toBe(true);
    expect(set.roleIsSet("vision")).toBe(false);
  });

  it("skips a role whose model can't run", () => {
    const { catalog } = catalogOf({ ...base, roles: { bot_default: "gpt-old" } });
    expect(catalog.forRole("bot_default")?.id).toBe("sonnet");
  });

  it("can answer once some chat model can run", () => {
    expect(catalogOf(base).catalog.canAnswer()).toBe(true);
    expect(catalogOf({ providers: [], models: [], roles: {} }).catalog.canAnswer()).toBe(false);
  });

  it("lists accounts with their status and model count, never a key", () => {
    const summaries = catalogOf(base).catalog.providers();
    expect(summaries.find((p) => p.id === "oai")).toEqual({
      id: "oai",
      name: "OpenAI",
      kind: "openai-responses",
      status: "ok",
      enabled: true,
      modelCount: 2,
    });
    expect(JSON.stringify(summaries)).not.toContain("key-");
  });
});

describe("Provider kinds", () => {
  it("builds nothing for a disabled account or a Claude plan", () => {
    const ids = buildProviders(
      {
        ...base,
        providers: base.providers.map((p) => (p.id === "oai" ? { ...p, enabled: false } : p)),
      },
      credentials,
    ).map((p) => p.id);
    expect(ids).toEqual(["anth"]);
  });

  it("resolves an account's key through the resolver, per request", async () => {
    const models = createModels();
    for (const provider of buildProviders(base, credentials)) models.setProvider(provider);
    const auth = await models.getAuth("anth");
    expect(auth).toMatchObject({ auth: { apiKey: "key-anth" } });
  });

  it("routes a gateway route's models through its gateway account, on the gateway's key", async () => {
    const config: ModelConfig = {
      providers: [
        account({
          id: "gw",
          kind: "cloudflare-ai-gateway",
          settings: { accountId: "acc", gatewayId: "gate" },
        }),
        account({
          id: "zai",
          kind: "openai-chat",
          hasCredential: false,
          viaProviderId: "gw",
          settings: { upstream: "custom-zai", basePath: "/api/coding/paas/v4/" },
        }),
      ],
      models: [
        row({ id: "glm", providerId: "zai", upstreamId: "glm-5.3-flash" }),
        row({ id: "jev", providerId: "gw", upstreamId: "typesafe/jev", type: "classifier" }),
      ],
      roles: { classifier: "jev" },
    };
    const { catalog, models } = catalogOf(config);
    expect(catalog.piModel("glm")?.baseUrl).toBe(
      "https://gateway.ai.cloudflare.com/v1/acc/gate/custom-zai/api/coding/paas/v4",
    );
    expect(await models.getAuth("zai")).toMatchObject({
      auth: { headers: { "cf-aig-authorization": "Bearer key-gw", Authorization: null } },
    });
    // Classifiers go to Workers AI under their own provider and auth.
    expect(catalog.route("jev")?.providerId).toBe(classifierProviderId("gw"));
    expect(catalog.classifierModel("jev")).toMatchObject({
      id: "typesafe/jev",
      baseUrl: "https://api.cloudflare.com/client/v4/accounts/acc/ai",
    });
  });

  it("sends a keyless account's requests without a key", async () => {
    const models = createModels();
    const config: ModelConfig = {
      providers: [
        account({
          id: "ollama",
          kind: "openai-chat",
          baseUrl: "http://localhost:11434/v1",
          hasCredential: false,
        }),
      ],
      models: [row({ id: "llama", providerId: "ollama" })],
      roles: {},
    };
    for (const provider of buildProviders(config, credentials)) models.setProvider(provider);
    expect(await models.getAuth("ollama")).toMatchObject({ auth: { apiKey: "no-key" } });
  });
});
