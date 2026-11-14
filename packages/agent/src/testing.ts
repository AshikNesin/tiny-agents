/**
 * Test helpers: an AgentRuntime backed by pi-ai's faux provider, so tests run
 * the real durable machinery without network access or API keys.
 */
import type { Context as PiContext } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxThinking,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";

export { fauxAssistantMessage, fauxText, fauxThinking, fauxToolCall };
/** In-memory MCP server pieces for connection tests (no network). */
export { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
export { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
export { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { AgentRuntime, type AgentRuntimeOptions } from "./runtime";
import type { ModelConfig, ModelRow } from "@tiny-agents/models";

export const TEST_PROVIDER = "faux";
export const TEST_MODEL = "test-model";
export const TEST_MODEL_2 = "test-model-2";

/**
 * A faux model row: the row id is the upstream id, so tests and the faux dev
 * boot name a model as `test-model` everywhere.
 */
export function fauxModelRow(
  id: string,
  name: string,
  options: { reasoning?: boolean; provider?: string } = {},
): ModelRow {
  return {
    id,
    providerId: options.provider ?? TEST_PROVIDER,
    upstreamId: id,
    name,
    type: "chat",
    enabled: true,
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    imageInput: false,
    reasoning: options.reasoning ?? false,
    compat: null,
    missing: false,
  };
}

/** A model config with one faux account holding `rows` (the host registers the faux provider). */
export function fauxModelConfig(
  rows: readonly ModelRow[],
  extra: Partial<ModelConfig> = {},
): ModelConfig {
  return {
    providers: [
      {
        id: TEST_PROVIDER,
        name: "Faux",
        kind: "faux",
        baseUrl: null,
        hasCredential: false,
        viaProviderId: null,
        settings: {},
        enabled: true,
        status: "ok",
        statusDetail: null,
      },
      ...(extra.providers ?? []),
    ],
    models: [...rows, ...(extra.models ?? [])],
    roles: extra.roles ?? {},
  };
}

export interface TestRuntimeOptions extends Partial<AgentRuntimeOptions> {
  storePath: string;
  /** Builds the reply text for the latest user message. Default: `Echo: <text>`. */
  reply?: (userText: string, systemPrompt: string | undefined) => string;
  /**
   * Full control of each faux reply (e.g. tool calls via `fauxToolCall`).
   * The queue cycles: each function is reused after the queue drains.
   */
  respondWith?: (context: PiContext) => ReturnType<typeof fauxAssistantMessage>;
  /** Optional thinking text attached to each reply. */
  reasoning?: string;
  /** Streaming speed of the faux model (tokens per second). Default: instant. */
  tokensPerSecond?: number;
}

function lastUserText(context: PiContext): string {
  for (let i = context.messages.length - 1; i >= 0; i--) {
    const message = context.messages[i];
    if (message.role !== "user") continue;
    if (typeof message.content === "string") return message.content;
    return message.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("");
  }
  return "";
}

export async function openTestRuntime(options: TestRuntimeOptions): Promise<AgentRuntime> {
  const models = createModels();
  const faux = fauxProvider({
    provider: TEST_PROVIDER,
    models: [
      { id: TEST_MODEL, name: "Test Model", reasoning: true },
      { id: TEST_MODEL_2, name: "Test Model 2" },
    ],
    ...(options.tokensPerSecond ? { tokensPerSecond: options.tokensPerSecond } : {}),
  });
  const reply = options.reply ?? ((text: string) => `Echo: ${text}`);
  // respondWith gets full control (tool calls, multi-step); otherwise the
  // plain echo/text reply.
  const respond = (context: PiContext) => {
    if (options.respondWith) return options.respondWith(context);
    const system = typeof context.systemPrompt === "string" ? context.systemPrompt : undefined;
    const text = reply(lastUserText(context), system);
    return fauxAssistantMessage(
      options.reasoning ? [fauxThinking(options.reasoning), fauxText(text)] : [fauxText(text)],
    );
  };
  // The faux provider consumes one queued response per request; keep plenty queued.
  faux.setResponses(Array.from({ length: 500 }, () => respond));
  models.setProvider(faux.provider);
  const { reply: _r, reasoning: _t, tokensPerSecond: _s, respondWith: _w, ...rest } = options;
  return AgentRuntime.open({
    modelConfig: fauxModelConfig([
      fauxModelRow(TEST_MODEL, "Test Model", { reasoning: true }),
      fauxModelRow(TEST_MODEL_2, "Test Model 2"),
    ]),
    ...rest,
    models,
    settings: { retry: { enabled: false }, ...rest.settings },
  });
}
/** In-process SSH server (issue #19 sandbox tests): none-auth, canned exec, real SFTP. */
export {
  startFakeSandboxServer,
  type FakeSandboxServer,
  type ExecHandler,
} from "./testing-ssh-server";
