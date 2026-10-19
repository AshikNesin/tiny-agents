/**
 * Transcriber selection order (issue #17, production fix): the owner's
 * custom glm-5.3-flash is preferred over the workers-ai catalog default,
 * because custom providers register input:["text"] while the upstream model
 * accepts images. VISION_MODEL still wins; VISION_BASE_URL is the last
 * resort. Empty answers now retry once before surfacing.
 */
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { Api, Model } from "@earendil-works/pi-ai";
import {
  createTranscriber,
  type TranscriberModels,
} from "../../../../packages/agent/src/toolkits/vision-transcribe";

const fakeModels = (
  providers: Record<string, { id: string; input: string[] }[]>,
): TranscriberModels => ({
  getProviders: () => Object.keys(providers).map((id) => ({ id })),
  getModels: (providerId) => (providers[providerId] ?? []) as never,
  getModel: (providerId, id) =>
    ((providers[providerId] ?? []).find((m) => m.id === id) ?? undefined) as Model<Api> | undefined,
  completeSimple: vi.fn(),
});

const GATEWAY = "cloudflare-ai-gateway";
const flash = { id: "glm-5.3-flash", input: ["text"] };
const workers = { id: "workers-ai/@cf/google/gemma-4-26b-a4b-it", input: ["text", "image"] };

afterEach(() => {
  delete process.env.VISION_MODEL;
  delete process.env.VISION_BASE_URL;
});

describe("createTranscriber selection", () => {
  it("prefers the owner's custom glm-5.3-flash over workers-ai", () => {
    const models = fakeModels({
      [GATEWAY]: [workers],
      "custom-zai-coding-plan": [flash],
    });
    const t = createTranscriber(models, { providerId: GATEWAY, env: {} });
    expect(t.availableModelIds()[0]).toBe("custom:custom-zai-coding-plan/glm-5.3-flash");
  });

  it("VISION_MODEL overrides everything when it resolves", () => {
    const models = fakeModels({ "custom-zai-coding-plan": [flash], [GATEWAY]: [workers] });
    const t = createTranscriber(models, {
      providerId: GATEWAY,
      env: { VISION_MODEL: "workers-ai/@cf/google/gemma-4-26b-a4b-it" },
    });
    expect(t.availableModelIds()[0]).toBe("workers-ai/@cf/google/gemma-4-26b-a4b-it");
  });

  it("falls back to workers-ai when no custom flash exists", () => {
    const t = createTranscriber(fakeModels({ [GATEWAY]: [workers] }), {
      providerId: GATEWAY,
      env: {},
    });
    expect(t.availableModelIds()[0]).toBe(workers.id);
  });

  it("retries an empty answer once before failing", async () => {
    const completeSimple = vi
      .fn<() => Promise<{ content: { type: string; text: string }[] }>>()
      .mockResolvedValueOnce({ content: [{ type: "text", text: "  " }] })
      .mockResolvedValueOnce({ content: [{ type: "text", text: "A red button labeled Save." }] });
    const models = { ...fakeModels({ "custom-zai-coding-plan": [flash] }), completeSimple };
    const t = createTranscriber(models as unknown as TranscriberModels, {
      providerId: GATEWAY,
      env: {},
    });
    const text = await t.transcribe({ data: "aGk=", mimeType: "image/png", name: "x.png" });
    expect(text).toBe("A red button labeled Save.");
    expect(completeSimple).toHaveBeenCalledTimes(2);
  });
});
