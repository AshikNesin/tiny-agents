import type { Api, Model } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vite-plus/test";
import {
  createModelCatalog,
  formatModelId,
  parseModelId,
  toModelInfo,
  type CatalogModels,
} from "../../../../packages/agent/src/model-catalog";

const model = (id: string, extra: Partial<Model<Api>> = {}): Model<Api> =>
  ({
    id,
    name: id.toUpperCase(),
    api: "openai-completions",
    provider: "",
    reasoning: false,
    contextWindow: 8_192,
    input: ["text"],
    ...extra,
  }) as unknown as Model<Api>;

/** A registry: provider id → its display name and models. */
function registry(
  providers: Record<string, { name: string; models: Model<Api>[] }>,
): CatalogModels {
  return {
    getProvider: (id: string) => (providers[id] ? { id, name: providers[id].name } : undefined),
    getProviders: () => Object.keys(providers).map((id) => ({ id, name: providers[id].name })),
    getModels: (id: string) => providers[id]?.models ?? [],
    getModel: (provider: string, id: string) =>
      providers[provider]?.models.find((m) => m.id === id),
  } as unknown as CatalogModels;
}

const models = registry({
  gw: { name: "Gateway", models: [model("glm"), model("claude-sonnet-4-6")] },
  acme: { name: "Acme", models: [model("eye", { input: ["text", "image"] })] },
  idle: { name: "Idle", models: [model("never")] },
});
const catalog = (env: Record<string, string> = {}, configured = ["gw", "acme"]) =>
  createModelCatalog(models, { primary: "gw", configured: new Set(configured), env });

describe("model ids", () => {
  it("reads the three forms and formats registry ids back", () => {
    expect(parseModelId("glm", "gw")).toEqual({ engine: "pi", provider: "gw", model: "glm" });
    expect(parseModelId("custom:acme/a/b", "gw")).toEqual({
      engine: "pi",
      provider: "acme",
      model: "a/b",
    });
    expect(parseModelId("claude-code/claude-opus-4-6", "gw")).toEqual({
      engine: "claude-code",
      bare: "claude-opus-4-6",
    });
    for (const bad of ["", "custom:/glm", "custom:acme/", "custom:acme", "claude-code/a/b"]) {
      expect(parseModelId(bad, "gw")).toBeUndefined();
    }
    expect(formatModelId({ provider: "gw", model: "glm" }, "gw")).toBe("glm");
    expect(formatModelId({ provider: "acme", model: "a/b" }, "gw")).toBe("custom:acme/a/b");
  });

  it("puts a custom provider's models in the 'other' family", () => {
    const glm = model("glm");
    expect(toModelInfo(glm, { provider: "acme", primary: "gw" })).toMatchObject({
      id: "custom:acme/glm",
      family: "other",
    });
    expect(toModelInfo(glm, { provider: "gw", primary: "gw" })).toMatchObject({
      id: "glm",
      family: "openai",
    });
  });
});

describe("createModelCatalog", () => {
  it("lists configured providers, the primary's ids bare, then the Claude plan models", () => {
    const list = catalog().list();
    const ids = list.map((m) => m.id);
    expect(ids.slice(0, 3)).toEqual(["glm", "claude-sonnet-4-6", "custom:acme/eye"]);
    expect(ids).not.toContain("custom:idle/never");
    expect(ids).toContain("claude-code/claude-opus-4-6");
    expect(list.find((m) => m.id === "custom:acme/eye")).toMatchObject({
      provider: "Acme",
      vision: true,
    });
  });

  it("lists every provider while none is configured", () => {
    expect(
      catalog({}, [])
        .list()
        .map((m) => m.id),
    ).toContain("custom:idle/never");
  });

  it("trims only the picker with the allowlist (quote-wrapped is fine)", () => {
    const allowed = catalog({ GATEWAY_MODEL_ALLOWLIST: '" glm , custom:acme/eye "' });
    expect(allowed.list().map((m) => m.id)).toEqual(["glm", "custom:acme/eye"]);
    // A bot saved on a model the allowlist hides keeps running and stays editable.
    expect(allowed.has("claude-sonnet-4-6")).toBe(true);
    expect(allowed.info("claude-sonnet-4-6")).toMatchObject({ id: "claude-sonnet-4-6" });
  });

  it("knows served registry ids and any well-formed Claude plan id", () => {
    const c = catalog();
    expect(c.has("glm")).toBe(true);
    expect(c.has("custom:acme/eye")).toBe(true);
    expect(c.has("custom:acme/glm")).toBe(false);
    expect(c.has("nope")).toBe(false);
    expect(c.has("claude-code/claude-future-9")).toBe(true);
    expect(c.has("claude-code/a b")).toBe(false);
  });

  it("resolves a Claude plan id to the same model on a provider that serves it", () => {
    const c = catalog();
    expect(c.resolve("claude-code/claude-sonnet-4-6")).toEqual({
      provider: "gw",
      model: "claude-sonnet-4-6",
    });
    expect(c.resolve("claude-code/claude-opus-4-6")).toBeUndefined();
    expect(c.resolve("custom:acme/eye")).toEqual({ provider: "acme", model: "eye" });
    expect(c.model("custom:acme/eye")?.id).toBe("eye");
  });

  it("says whether a model sees images, wherever it is served", () => {
    const c = catalog();
    expect(c.info("custom:acme/eye")?.vision).toBe(true);
    expect(c.info("glm")?.vision).toBe(false);
    expect(c.info("claude-code/claude-opus-4-6")?.vision).toBe(true);
    expect(c.info("custom:idle/missing")).toBeUndefined();
  });

  it("reports its providers, primary first, and whether one can answer", () => {
    expect(catalog().providers()).toEqual([
      expect.objectContaining({ id: "gw", name: "Gateway", configured: true }),
    ]);
    expect(catalog().canAnswer()).toBe(true);
    expect(catalog({}, []).canAnswer()).toBe(false);
    // The faux provider (dev, E2E) answers without credentials.
    const faux = createModelCatalog(models, { primary: "faux", configured: new Set(), env: {} });
    expect(faux.canAnswer()).toBe(true);
  });
});
