import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { logger } from "@groot/core/logger";
import { db, llmCalls } from "../../../../apps/web/src/server/db";
import { secretRedactor } from "../../../../packages/agent/src/redact";
import type { Api, Model } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxText } from "../../../../packages/agent/src/testing";
import {
  createModelCatalog,
  type CatalogModels,
} from "../../../../packages/models/src/model-catalog";
import type {
  ModelConfig,
  ModelRow,
  ProviderAccount,
} from "../../../../packages/models/src/config";
import {
  createSideCaller,
  type SideCallRequest,
  type SideCallRuntime,
} from "../../../../apps/web/src/server/api/bots/side-call";

vi.mock("@groot/core/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

type Completion = SideCallRuntime["models"]["completeSimple"];

const account = (id: string, kind: ProviderAccount["kind"]): ProviderAccount => ({
  id,
  name: id,
  kind,
  baseUrl: null,
  hasCredential: true,
  viaProviderId: null,
  settings: {},
  enabled: true,
  status: "ok",
  statusDetail: null,
});

const row = (id: string, providerId: string): ModelRow => ({
  id,
  providerId,
  upstreamId: `${id}-upstream`,
  name: id,
  type: "chat",
  enabled: true,
  contextWindow: 100_000,
  maxOutputTokens: 8_000,
  imageInput: false,
  reasoning: false,
  compat: null,
  missing: false,
});

function fakeRuntime(
  reply: Completion = async () => fauxAssistantMessage([fauxText("answer")]),
  roles: ModelConfig["roles"] = {},
  config: Partial<ModelConfig> = {},
) {
  const getModel = vi.fn((provider: string, id: string) => ({ id, provider }) as Model<Api>);
  const completeSimple = vi.fn<Completion>(reply);
  const registry = { getModel, getModelOfType: () => undefined } as unknown as CatalogModels;
  const runtime: SideCallRuntime = {
    catalog: createModelCatalog(
      {
        providers: config.providers ?? [account("p", "anthropic"), account("plan", "claude-plan")],
        models: config.models ?? [
          row("bot-model", "p"),
          row("light", "p"),
          row("plan-model", "plan"),
        ],
        roles,
      },
      registry,
    ),
    models: { completeSimple },
  };
  return { runtime, getModel, completeSimple };
}

const request = (overrides: Partial<SideCallRequest> = {}): SideCallRequest => ({
  role: "chat_title",
  botModelId: "bot-model",
  system: "You are a test.",
  user: "Go.",
  timeoutMs: 1_000,
  label: "Test call",
  ...overrides,
});

describe("createSideCaller: the model", () => {
  it("runs on the role's model when set, else the bot's own pi model", async () => {
    const set = fakeRuntime(undefined, { chat_title: "light" });
    await expect(createSideCaller(set.runtime).complete(request())).resolves.toBe("answer");
    expect(set.completeSimple.mock.calls.at(-1)?.[0]).toEqual({
      id: "light-upstream",
      provider: "p",
    });

    const unset = fakeRuntime();
    await expect(createSideCaller(unset.runtime).complete(request())).resolves.toBe("answer");
    expect(unset.completeSimple.mock.calls.at(-1)?.[0]).toEqual({
      id: "bot-model-upstream",
      provider: "p",
    });
  });

  it("runs a Claude plan bot's call on the default model", async () => {
    const { runtime, completeSimple } = fakeRuntime(undefined, {
      bot_default: "light",
    });
    await expect(
      createSideCaller(runtime).complete(request({ botModelId: "plan-model" })),
    ).resolves.toBe("answer");
    expect(completeSimple.mock.calls.at(-1)?.[0]).toEqual({
      id: "light-upstream",
      provider: "p",
    });
  });

  it("makes no call, and says so, when no model can run", async () => {
    const { runtime, completeSimple } = fakeRuntime(undefined, {}, { providers: [], models: [] });
    expect(await createSideCaller(runtime).complete(request())).toBeUndefined();
    expect(completeSimple).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ label: "Test call" }),
      expect.stringContaining("no model"),
    );
  });

  it("sends the system prompt and the user text, and joins the reply's text blocks", async () => {
    const { runtime, completeSimple } = fakeRuntime(async () =>
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

describe("createSideCaller: what it sends", () => {
  it("scrubs vault values from the prompt and the user text before they reach the model", async () => {
    const secret = "sk-side-call-test-9f3b2c";
    secretRedactor.register(secret);
    const { runtime, completeSimple } = fakeRuntime();
    await createSideCaller(runtime).complete(
      request({ system: `Memories: key is ${secret}`, user: `Owner: use ${secret} please` }),
    );
    const [, context] = completeSimple.mock.calls[0]!;
    expect(context.systemPrompt).toBe("Memories: key is [vault]");
    expect(context.messages[0]).toMatchObject({
      content: [{ type: "text", text: "Owner: use [vault] please" }],
    });
  });
});

describe("createSideCaller: failures", () => {
  it("reads an error or aborted stop as no answer, and logs it", async () => {
    const { runtime } = fakeRuntime(async () => ({
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
    const { runtime } = fakeRuntime(async () => {
      throw new Error("gateway down");
    });
    await expect(createSideCaller(runtime).complete(request())).resolves.toBeUndefined();
  });

  it("aborts the call at the deadline and answers then, even when the provider ignores the abort", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const { runtime } = fakeRuntime((_model, _context, options) => {
      signal = options?.signal;
      return new Promise(() => undefined);
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
    const { runtime } = fakeRuntime(async (_model, _context, options) => {
      signal = options?.signal;
      return fauxAssistantMessage([fauxText("ok")]);
    });
    const cancel = new AbortController();
    await createSideCaller(runtime).complete(request({ signal: cancel.signal }));
    cancel.abort();
    expect(signal?.aborted).toBe(true);
  });
});

describe("createSideCaller: the trace", () => {
  it("keeps one metadata row per call, with no prompt or answer", async () => {
    await db.delete(llmCalls);
    const usage = {
      input: 1_200,
      output: 40,
      cacheRead: 800,
      cacheWrite: 0,
      totalTokens: 2_040,
      cost: { input: 0.001, output: 0.0005, cacheRead: 0.0001, cacheWrite: 0, total: 0.0016 },
    };
    const { runtime } = fakeRuntime(async () => ({
      ...fauxAssistantMessage([fauxText("Secret answer")]),
      usage,
    }));
    await createSideCaller(runtime).complete(
      request({ label: "Chat title", botId: undefined, user: "Secret prompt" }),
    );
    const rows = await db.select().from(llmCalls);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      purpose: "Chat title",
      modelId: "bot-model",
      provider: "p",
      model: "bot-model-upstream",
      inputTokens: 1_200,
      outputTokens: 40,
      cacheReadTokens: 800,
      costUsd: 0.0016,
      outcome: "ok",
      error: null,
    });
    expect(JSON.stringify(rows[0])).not.toMatch(/Secret/);
  });

  it("records a failed call's outcome and error", async () => {
    await db.delete(llmCalls);
    const { runtime } = fakeRuntime(async () => {
      throw new Error("gateway down");
    });
    await createSideCaller(runtime).complete(request());
    const rows = await db.select().from(llmCalls);
    expect(rows).toMatchObject([{ purpose: "Test call", outcome: "error", error: "gateway down" }]);
  });

  it("prunes rows older than 30 days as it writes", async () => {
    await db.delete(llmCalls);
    await db.insert(llmCalls).values({
      purpose: "Old",
      outcome: "ok",
      createdAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
    });
    await createSideCaller(fakeRuntime().runtime).complete(request());
    const rows = await db.select().from(llmCalls);
    expect(rows.map((row) => row.purpose)).toEqual(["Test call"]);
  });
});
