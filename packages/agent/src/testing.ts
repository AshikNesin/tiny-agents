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
} from "@earendil-works/pi-ai/providers/faux";

export { fauxAssistantMessage, fauxText, fauxThinking };
import { AgentRuntime, type AgentRuntimeOptions } from "./runtime";

export const TEST_PROVIDER = "faux";
export const TEST_MODEL = "test-model";
export const TEST_MODEL_2 = "test-model-2";

export interface TestRuntimeOptions extends Partial<AgentRuntimeOptions> {
  storePath: string;
  /** Builds the reply text for the latest user message. Default: `Echo: <text>`. */
  reply?: (userText: string, systemPrompt: string | undefined) => string;
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
  const respond = (context: PiContext) => {
    const system = typeof context.systemPrompt === "string" ? context.systemPrompt : undefined;
    const text = reply(lastUserText(context), system);
    return fauxAssistantMessage(
      options.reasoning ? [fauxThinking(options.reasoning), fauxText(text)] : [fauxText(text)],
    );
  };
  // The faux provider consumes one queued response per request; keep plenty queued.
  faux.setResponses(Array.from({ length: 500 }, () => respond));
  models.setProvider(faux.provider);
  const { reply: _r, reasoning: _t, tokensPerSecond: _s, ...rest } = options;
  return AgentRuntime.open({
    ...rest,
    models,
    provider: TEST_PROVIDER,
    settings: { retry: { enabled: false }, ...rest.settings },
  });
}
