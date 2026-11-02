/**
 * AI_PROVIDERS: bots run on any pi-ai provider, not only the Cloudflare AI
 * Gateway. The first provider owns bare model ids; the others are
 * namespaced "custom:<provider>/<model>". Credentials come from each
 * provider's own env vars (read from process.env, as requests read them).
 */
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  aiProviderIds,
  createProviderModels,
  GATEWAY_PROVIDER,
  primaryProviderId,
  providerSetupHint,
} from "../../../../packages/agent/src/models";
import { AgentRuntime } from "../../../../packages/agent/src/runtime";

const CREDENTIAL_VARS = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "CLOUDFLARE_API_KEY",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_GATEWAY_ID",
];

/** Start each runtime from no credentials at all, then add what the test names. */
function credentials(values: Record<string, string> = {}) {
  for (const name of CREDENTIAL_VARS) vi.stubEnv(name, values[name] ?? "");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("aiProviderIds", () => {
  it("defaults to the Cloudflare AI Gateway", () => {
    expect(aiProviderIds({})).toEqual([GATEWAY_PROVIDER]);
    expect(aiProviderIds({ AI_PROVIDERS: "  " })).toEqual([GATEWAY_PROVIDER]);
    expect(primaryProviderId({})).toBe(GATEWAY_PROVIDER);
  });

  it("keeps order, trims, lowercases, dedupes and tolerates quotes", () => {
    expect(aiProviderIds({ AI_PROVIDERS: '" OpenAI , cloudflare-ai-gateway,openai"' })).toEqual([
      "openai",
      GATEWAY_PROVIDER,
    ]);
    expect(primaryProviderId({ AI_PROVIDERS: "openai,anthropic" })).toBe("openai");
  });

  it("drops unknown ids and falls back to the gateway when none is left", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(aiProviderIds({ AI_PROVIDERS: "nope,openai" })).toEqual(["openai"]);
    expect(aiProviderIds({ AI_PROVIDERS: "nope-only" })).toEqual([GATEWAY_PROVIDER]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("createProviderModels", () => {
  it("registers only the listed providers", () => {
    const ids = createProviderModels({ AI_PROVIDERS: "openai" })
      .getProviders()
      .map((p) => p.id);
    expect(ids).toEqual(["openai"]);
  });

  it("registers gateway custom providers only alongside the gateway", () => {
    const env = {
      GATEWAY_CUSTOM_PROVIDERS: JSON.stringify([
        { id: "custom-zai", models: [{ id: "glm-5.3-flash" }] },
      ]),
      CLOUDFLARE_ACCOUNT_ID: "acc",
      CLOUDFLARE_GATEWAY_ID: "gw",
    };
    const without = createProviderModels({ ...env, AI_PROVIDERS: "openai" });
    expect(without.getProvider("custom-zai")).toBeUndefined();
    const withGateway = createProviderModels({
      ...env,
      AI_PROVIDERS: "cloudflare-ai-gateway,openai",
    });
    expect(withGateway.getProvider("custom-zai")).toBeDefined();
    expect(withGateway.getProvider("openai")).toBeDefined();
  });
});

describe("AgentRuntime on AI_PROVIDERS", () => {
  it("runs on OpenAI alone with bare ids and resolves them", async () => {
    credentials({ OPENAI_API_KEY: "sk-test" });
    const runtime = await AgentRuntime.open({
      storePath: ":memory:",
      env: { AI_PROVIDERS: "openai" },
    });
    try {
      expect(runtime.provider).toBe("openai");
      const models = runtime.listModels();
      expect(models.length).toBeGreaterThan(0);
      expect(models.every((m) => !m.id.startsWith("custom:"))).toBe(true);
      expect(models.every((m) => m.provider === "OpenAI")).toBe(true);
      expect(runtime.hasModel(models[0].id)).toBe(true);
      expect(runtime.providerStatus()).toEqual([
        {
          id: "openai",
          name: "OpenAI",
          configured: true,
          setupHint: providerSetupHint("openai", "OpenAI"),
        },
      ]);
      expect(runtime.hasConfiguredProvider()).toBe(true);
    } finally {
      await runtime.close();
    }
  });

  it("namespaces the second provider and hides it until it has credentials", async () => {
    credentials({ OPENAI_API_KEY: "sk-test" });
    const env = { AI_PROVIDERS: "openai,anthropic" };
    const runtime = await AgentRuntime.open({ storePath: ":memory:", env });
    try {
      const ids = runtime.listModels().map((m) => m.id);
      // Anthropic has no key: only OpenAI's models are offered.
      expect(ids.some((id) => id.startsWith("custom:anthropic/"))).toBe(false);
      expect(runtime.providerStatus().map((s) => [s.id, s.configured])).toEqual([
        ["openai", true],
        ["anthropic", false],
      ]);
    } finally {
      await runtime.close();
    }

    credentials({ OPENAI_API_KEY: "sk-test", ANTHROPIC_API_KEY: "sk-ant-test" });
    const both = await AgentRuntime.open({ storePath: ":memory:", env });
    try {
      const anthropic = both.listModels().filter((m) => m.id.startsWith("custom:anthropic/"));
      expect(anthropic.length).toBeGreaterThan(0);
      expect(anthropic[0].family).toBe("anthropic");
      expect(both.hasModel(anthropic[0].id)).toBe(true);
    } finally {
      await both.close();
    }
  });

  it("lists every model with setup hints when no provider is configured", async () => {
    credentials();
    const runtime = await AgentRuntime.open({
      storePath: ":memory:",
      env: { AI_PROVIDERS: "cloudflare-ai-gateway,openai" },
    });
    try {
      expect(runtime.hasConfiguredProvider()).toBe(false);
      const ids = runtime.listModels().map((m) => m.id);
      expect(ids.some((id) => id.startsWith("custom:openai/"))).toBe(true);
      expect(ids.some((id) => !id.startsWith("custom:"))).toBe(true);
      const hints = runtime.providerStatus().map((s) => s.setupHint);
      expect(hints[0]).toContain("CLOUDFLARE_GATEWAY_ID");
      expect(hints[1]).toContain("OPENAI_API_KEY");
    } finally {
      await runtime.close();
    }
  });
});
