import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { logger } from "@groot/core/logger";
import type { Api, Model } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxText } from "../../../../packages/agent/src/testing";
import {
  createModelCatalog,
  formatModelId,
  type CatalogModels,
} from "../../../../packages/agent/src/model-catalog";
import { GATEWAY_PROVIDER } from "../../../../packages/agent/src/models";
import {
  createSideCaller,
  type SideCallRequest,
  type SideCallRuntime,
} from "../../../../apps/web/src/server/api/bots/side-call";

vi.mock("@groot/core/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

type Completion = SideCallRuntime["models"]["completeSimple"];

/**
 * A runtime whose registry serves `known` app model ids (bare on `primary`,
 * `custom:<provider>/<model>` elsewhere) and answers with `reply`. The
 * catalog is the real one over that registry.
 */
function fakeRuntime(
  known: string[],
  reply: Completion = async () => fauxAssistantMessage([fauxText("answer")]),
  primary = GATEWAY_PROVIDER,
) {
  const getModel = vi.fn((provider: string, id: string) =>
    known.includes(formatModelId({ provider, model: id }, primary))
      ? ({ id } as Model<Api>)
      : undefined,
  );
  const completeSimple = vi.fn<Completion>(reply);
  const registry = {
    getModel,
    getModels: () => [],
    getProviders: () => [],
    getProvider: () => undefined,
  } as unknown as CatalogModels;
  const runtime: SideCallRuntime = {
    catalog: createModelCatalog(registry, { primary, configured: new Set(), env: {} }),
    models: { completeSimple },
  };
  return { runtime, getModel, completeSimple };
}

const request = (overrides: Partial<SideCallRequest> = {}): SideCallRequest => ({
  botModelId: "bot-model",
  system: "You are a test.",
  user: "Go.",
  timeoutMs: 1_000,
  label: "Test call",
  ...overrides,
});

describe("createSideCaller: the model", () => {
  it("prefers a known override (quotes tolerated), else the bot's model, else no call", async () => {
    const { runtime, getModel, completeSimple } = fakeRuntime(["bot-model", "custom:test/light"]);
    const caller = createSideCaller(runtime);

    await caller.complete(request({ override: '"custom:test/light"' }));
    expect(getModel).toHaveBeenLastCalledWith("test", "light");

    await caller.complete(request({ override: "unknown" }));
    expect(getModel).toHaveBeenLastCalledWith("cloudflare-ai-gateway", "bot-model");

    completeSimple.mockClear();
    expect(await caller.complete(request({ botModelId: "missing" }))).toBeUndefined();
    expect(completeSimple).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ label: "Test call" }),
      expect.stringContaining("no model"),
    );
  });

  it("runs a Claude plan bot's call on the same model a registry provider serves", async () => {
    const { runtime, getModel, completeSimple } = fakeRuntime(["claude-sonnet-4-6"]);
    const caller = createSideCaller(runtime);

    await caller.complete(request({ botModelId: "claude-code/claude-sonnet-4-6" }));
    expect(getModel).toHaveBeenLastCalledWith("cloudflare-ai-gateway", "claude-sonnet-4-6");
    expect(completeSimple).toHaveBeenCalledOnce();

    completeSimple.mockClear();
    expect(
      await caller.complete(request({ botModelId: "claude-code/claude-opus-4-6" })),
    ).toBeUndefined();
    expect(completeSimple).not.toHaveBeenCalled();
  });

  it("maps bare ids to the runtime's primary provider", async () => {
    const { runtime, getModel } = fakeRuntime(["bot-model"], undefined, "openrouter");
    await createSideCaller(runtime).complete(request());
    expect(getModel).toHaveBeenCalledWith("openrouter", "bot-model");
  });

  it("sends the system prompt and the user text, and joins the reply's text blocks", async () => {
    const { runtime, completeSimple } = fakeRuntime(["bot-model"], async () =>
      fauxAssistantMessage([fauxText("one"), fauxText("two")]),
    );
    expect(await createSideCaller(runtime).complete(request())).toBe("one\ntwo");
    const [, context] = completeSimple.mock.calls[0]!;
    expect(context.systemPrompt).toBe("You are a test.");
    expect(context.messages).toEqual([
      expect.objectContaining({ role: "user", content: [{ type: "text", text: "Go." }] }),
    ]);
  });
});

describe("createSideCaller: failures", () => {
  it("reads an error or aborted stop as no answer, and logs it", async () => {
    const { runtime } = fakeRuntime(["bot-model"], async () => ({
      ...fauxAssistantMessage([fauxText("partial")]),
      stopReason: "error",
      errorMessage: "Provider unavailable",
    }));
    expect(
      await createSideCaller(runtime).complete(request({ context: { chatId: "c1" } })),
    ).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "c1",
        modelId: "bot-model",
        stopReason: "error",
        errorMessage: "Provider unavailable",
      }),
      expect.stringContaining("model failed"),
    );
  });

  it("reads a thrown call as no answer", async () => {
    const { runtime } = fakeRuntime(["bot-model"], async () => {
      throw new Error("gateway down");
    });
    await expect(createSideCaller(runtime).complete(request())).resolves.toBeUndefined();
  });

  it("aborts the call at the deadline and answers then, even when the provider ignores the abort", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const { runtime } = fakeRuntime(["bot-model"], (_model, _context, options) => {
      signal = options?.signal;
      return new Promise(() => undefined); // never settles
    });
    const answer = createSideCaller(runtime).complete(request({ timeoutMs: 500 }));
    await vi.advanceTimersByTimeAsync(500);
    await expect(answer).resolves.toBeUndefined();
    expect(signal?.aborted).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ timeoutMs: 500 }),
      expect.stringContaining("timed out"),
    );
  });

  it("passes the caller's own cancel through", async () => {
    let signal: AbortSignal | undefined;
    const { runtime } = fakeRuntime(["bot-model"], async (_model, _context, options) => {
      signal = options?.signal;
      return fauxAssistantMessage([fauxText("ok")]);
    });
    const cancel = new AbortController();
    await createSideCaller(runtime).complete(request({ signal: cancel.signal }));
    cancel.abort();
    expect(signal?.aborted).toBe(true);
  });
});
