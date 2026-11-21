import type { Context as PiContext } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxThinking,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import { createNodePhotonImages } from "@earendil-works/pi-durable/images/node";

export { fauxAssistantMessage, fauxText, fauxThinking, fauxToolCall };
export { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
export { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
export { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { AgentRuntime, type AgentRuntimeOptions } from "./runtime";
import type { ModelConfig, ModelRow } from "@tiny-agents/models";

export const TEST_PROVIDER = "faux";
export const TEST_MODEL = "test-model";
export const TEST_MODEL_2 = "test-model-2";

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
  reply?: (userText: string, systemPrompt: string | undefined) => string;
  respondWith?: (context: PiContext) => ReturnType<typeof fauxAssistantMessage>;
  reasoning?: string;
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
  const respond = (context: PiContext) => {
    if (options.respondWith) return options.respondWith(context);
    const system = typeof context.systemPrompt === "string" ? context.systemPrompt : undefined;
    const text = reply(lastUserText(context), system);
    return fauxAssistantMessage(
      options.reasoning ? [fauxThinking(options.reasoning), fauxText(text)] : [fauxText(text)],
    );
  };
  faux.setResponses(Array.from({ length: 500 }, () => respond));
  models.setProvider(faux.provider);
  const { reply: _r, reasoning: _t, tokensPerSecond: _s, respondWith: _w, ...rest } = options;
  return AgentRuntime.open({
    modelConfig: fauxModelConfig([
      fauxModelRow(TEST_MODEL, "Test Model", { reasoning: true }),
      fauxModelRow(TEST_MODEL_2, "Test Model 2"),
    ]),
    images: await createNodePhotonImages({ worker: false }),
    ...rest,
    models,
    settings: { retry: { enabled: false }, ...rest.settings },
  });
}
export { startFakeSandboxServer } from "@tiny-agents/sandbox/testing";
export type { ExecHandler, FakeSandboxServer } from "@tiny-agents/sandbox/testing";
