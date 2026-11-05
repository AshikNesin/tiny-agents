import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { logger } from "@groot/core/logger";
import type { Api, Model } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxText } from "../../../../packages/agent/src/testing";
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

/** A runtime that knows `known` model ids and answers with `reply`. */
function fakeRuntime(
  known: string[],
  reply: Completion = async () => fauxAssistantMessage([fauxText("answer")]),
  provider?: string,
) {
  const getModel = vi.fn((_provider: string, id: string) => ({ id }) as Model<Api>);
  const completeSimple = vi.fn<Completion>(reply);
  const runtime: SideCallRuntime = {
    models: { getModel, completeSimple },
    hasModel: (id) => known.includes(id),
    ...(provider ? { provider } : {}),
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
