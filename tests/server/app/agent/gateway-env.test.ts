/**
 * Container-UI env tolerance: Coolify and docker-compose editors often keep
 * literal quotes around values ('"https://x"'). The gateway URL builders must
 * strip them instead of producing "Invalid URL" at send time, and must warn
 * (not crash) on genuinely malformed config.
 */
import { describe, expect, it } from "vite-plus/test";
import { createGatewayModels, ClaudeOauthTokenError } from "../../../../packages/agent/src/models";
import { AgentRuntime } from "../../../../packages/agent/src/runtime";

const GOOD_PROVIDERS = JSON.stringify([
  {
    id: "custom-zai-coding-plan",
    basePath: "api/coding/paas/v4",
    models: [{ id: "glm-5.3-flash", name: "GLM 5.3 Flash", reasoning: true }],
  },
]);

function models(env: Record<string, string | undefined>) {
  return createGatewayModels(env)
    .getProviders()
    .filter((p) => p.id.startsWith("custom-"));
}

describe("gateway env tolerance", () => {
  it("registers custom providers with clean env", () => {
    const providers = models({
      GATEWAY_CUSTOM_PROVIDERS: GOOD_PROVIDERS,
      CLOUDFLARE_ACCOUNT_ID: "acc",
      CLOUDFLARE_GATEWAY_ID: "gw",
    });
    expect(providers.map((p) => p.id)).toContain("custom-zai-coding-plan");
  });

  it("strips literal quotes the container UI kept around the JSON", () => {
    const providers = models({
      GATEWAY_CUSTOM_PROVIDERS: `"${GOOD_PROVIDERS}"`,
      CLOUDFLARE_ACCOUNT_ID: "acc",
      CLOUDFLARE_GATEWAY_ID: "gw",
    });
    expect(providers.map((p) => p.id)).toContain("custom-zai-coding-plan");
  });

  it("strips quotes around GATEWAY_BASE_URL and still builds valid URLs", () => {
    const env = {
      GATEWAY_CUSTOM_PROVIDERS: GOOD_PROVIDERS,
      GATEWAY_BASE_URL: '"https://gateway.example.com/"',
      CLOUDFLARE_ACCOUNT_ID: "acc",
      CLOUDFLARE_GATEWAY_ID: "gw",
    };
    const model = models(env)
      .flatMap((p) => createGatewayModels(env).getModels(p.id))
      .find((m) => m.id === "glm-5.3-flash");
    expect(model?.baseUrl).toBe(
      "https://gateway.example.com/v1/acc/gw/custom-zai-coding-plan/api/coding/paas/v4",
    );
  });

  it("falls back to the real gateway host when GATEWAY_BASE_URL is not a URL", () => {
    const registry = createGatewayModels({
      GATEWAY_CUSTOM_PROVIDERS: GOOD_PROVIDERS,
      GATEWAY_BASE_URL: "not a url",
      CLOUDFLARE_ACCOUNT_ID: "acc",
      CLOUDFLARE_GATEWAY_ID: "gw",
    });
    const model = registry
      .getProviders()
      .filter((p) => p.id === "custom-zai-coding-plan")
      .flatMap((p) => registry.getModels(p.id))
      .find((m) => m.id === "glm-5.3-flash");
    expect(model?.baseUrl).toMatch(/^https:\/\/gateway\.ai\.cloudflare\.com\//);
  });

  it("keeps the allowlist working when the whole value is quote-wrapped", async () => {
    const allow = AgentRuntime as unknown as { __testAllowlist?: never };
    void allow;
    // modelAllowlist is module-private; exercise it through listModels
    // with a permissive runtime (memory store, faux not needed — only
    // listModels is called).
    const runtime = await AgentRuntime.open({
      storePath: ":memory:",
      env: {
        GATEWAY_CUSTOM_PROVIDERS: GOOD_PROVIDERS,
        GATEWAY_MODEL_ALLOWLIST: '"custom:custom-zai-coding-plan/glm-5.3-flash"',
        CLOUDFLARE_ACCOUNT_ID: "acc",
        CLOUDFLARE_GATEWAY_ID: "gw",
      },
    });
    const ids = runtime.listModels().map((m) => m.id);
    expect(ids).toEqual(["custom:custom-zai-coding-plan/glm-5.3-flash"]);
    await runtime.close();
  });
});

describe("gateway auth scheme selection", () => {
  const PROVIDERS = JSON.stringify([
    {
      id: "custom-zai-coding-plan",
      basePath: "api/coding/paas/v4",
      models: [{ id: "glm-5.3-flash" }],
    },
  ]);

  it("direct-to-gateway: no placeholder header (native cf-aig auth applies)", () => {
    const registry = createGatewayModels({
      GATEWAY_CUSTOM_PROVIDERS: PROVIDERS,
      CLOUDFLARE_ACCOUNT_ID: "acc",
      CLOUDFLARE_GATEWAY_ID: "gw",
    });
    const model = registry
      .getProviders()
      .filter((p) => p.id === "custom-zai-coding-plan")
      .flatMap((p) => registry.getModels(p.id))[0];
    expect(model?.headers).toBeUndefined();
    expect(model?.baseUrl).toMatch(/^https:\/\/gateway\.ai\.cloudflare\.com\//);
  });

  it("behind GATEWAY_BASE_URL: placeholder bearer header present (proxy swaps it)", () => {
    const registry = createGatewayModels({
      GATEWAY_CUSTOM_PROVIDERS: PROVIDERS,
      GATEWAY_BASE_URL: "https://cf-proxy.example.com",
      CLOUDFLARE_ACCOUNT_ID: "acc",
      CLOUDFLARE_GATEWAY_ID: "gw",
    });
    const model = registry
      .getProviders()
      .filter((p) => p.id === "custom-zai-coding-plan")
      .flatMap((p) => registry.getModels(p.id))[0];
    expect(model?.headers).toEqual({ authorization: "Bearer unused" });
    expect(model?.baseUrl).toMatch(/^https:\/\/cf-proxy\.example\.com\//);
  });
});

describe("custom model image input", () => {
  it("declares glm-5.3-flash image-capable by default (production vision fix)", () => {
    const providers = models({
      GATEWAY_CUSTOM_PROVIDERS: GOOD_PROVIDERS,
      CLOUDFLARE_ACCOUNT_ID: "acc",
      CLOUDFLARE_GATEWAY_ID: "gw",
    });
    const flash = providers[0].getModels().find((m) => m.id === "glm-5.3-flash");
    expect(flash?.input).toContain("image");
  });

  it("honors vision:false to opt a model out", () => {
    const providers = models({
      GATEWAY_CUSTOM_PROVIDERS: JSON.stringify([
        { id: "custom-x", models: [{ id: "glm-5.3-flash", vision: false }] },
      ]),
      CLOUDFLARE_ACCOUNT_ID: "acc",
      CLOUDFLARE_GATEWAY_ID: "gw",
    });
    const m = providers[0].getModels().find((x) => x.id === "glm-5.3-flash");
    expect(m?.input).toEqual(["text"]);
  });

  it("opts other models in with vision:true", () => {
    const providers = models({
      GATEWAY_CUSTOM_PROVIDERS: JSON.stringify([
        { id: "custom-x", models: [{ id: "other-model", vision: true }] },
      ]),
      CLOUDFLARE_ACCOUNT_ID: "acc",
      CLOUDFLARE_GATEWAY_ID: "gw",
    });
    const m = providers[0].getModels().find((x) => x.id === "other-model");
    expect(m?.input).toContain("image");
  });
});

describe("Claude Code OAuth token guard", () => {
  it("refuses gateway setup when an env value holds an sk-ant-oat token", () => {
    const token = "sk-ant-oat01-do-not-keep";
    expect(() =>
      createGatewayModels({
        ANTHROPIC_API_KEY: token,
        CLOUDFLARE_ACCOUNT_ID: "acc",
        CLOUDFLARE_GATEWAY_ID: "gw",
      }),
    ).toThrow(ClaudeOauthTokenError);
  });

  it("refuses a token buried in custom provider JSON and does not echo the secret", () => {
    const token = "sk-ant-oat01-buried";
    try {
      createGatewayModels({
        GATEWAY_CUSTOM_PROVIDERS: JSON.stringify([{ id: "custom-x", apiKey: token, models: [] }]),
        CLOUDFLARE_ACCOUNT_ID: "acc",
        CLOUDFLARE_GATEWAY_ID: "gw",
      });
      throw new Error("expected the OAuth token to be refused");
    } catch (error) {
      expect(error).toBeInstanceOf(ClaudeOauthTokenError);
      expect((error as Error).message).not.toContain("buried");
      expect((error as ClaudeOauthTokenError).where).toBe("GATEWAY_CUSTOM_PROVIDERS[0].apiKey");
    }
  });

  it("refuses to open the runtime when model-provider config holds the token", async () => {
    await expect(
      AgentRuntime.open({
        storePath: ":memory:",
        env: { ANTHROPIC_AUTH_TOKEN: "sk-ant-oat01-runtime" },
      }),
    ).rejects.toBeInstanceOf(ClaudeOauthTokenError);
  });
});
