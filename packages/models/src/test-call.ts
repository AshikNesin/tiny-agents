/**
 * The Test button (issue #179): one real, minimal completion against a model
 * as configured, saved or not, so the owner sees the key and endpoint work
 * before a bot depends on them.
 */
import type { Api, ClassifierApi, ClassifierModel, Model } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import type { CredentialResolver, ModelConfig } from "./config";
import { buildProviders } from "./kinds";

/** A 1×1 transparent PNG: checks that the model takes image input. */
const PIXEL =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

export interface TestResult {
  ok: boolean;
  latencyMs: number;
  /** The provider's error, cut to 500 characters (the caller redacts it). */
  error?: string;
}

/** Call `model` once: 16 tokens at most, `timeoutMs` at most. */
export async function testModelCall(
  models: { completeSimple: ReturnType<typeof createModels>["completeSimple"] },
  model: Model<Api>,
  options: { image?: boolean; timeoutMs?: number } = {},
): Promise<TestResult> {
  const started = Date.now();
  const signal = AbortSignal.timeout(options.timeoutMs ?? 15_000);
  try {
    const reply = await models.completeSimple(
      options.image ? { ...model, input: ["text", "image"] } : model,
      {
        systemPrompt: "Answer with one word.",
        messages: [
          {
            role: "user",
            content: [
              ...(options.image
                ? [{ type: "image" as const, data: PIXEL, mimeType: "image/png" }]
                : []),
              { type: "text" as const, text: "Say OK." },
            ],
            timestamp: Date.now(),
          },
        ],
      },
      { maxTokens: 16, signal },
    );
    const latencyMs = Date.now() - started;
    if (reply.stopReason === "error" || reply.stopReason === "aborted") {
      return {
        ok: false,
        latencyMs,
        error: (reply.errorMessage ?? `The call ended: ${reply.stopReason}`).slice(0, 500),
      };
    }
    return { ok: true, latencyMs };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: (error instanceof Error ? error.message : String(error)).slice(0, 500),
    };
  }
}

/** Call classifier `model` once with one yes/no question, `timeoutMs` at most. */
export async function testClassifierCall(
  models: { classify: ReturnType<typeof createModels>["classify"] },
  model: ClassifierModel<ClassifierApi>,
  options: { timeoutMs?: number } = {},
): Promise<TestResult> {
  const started = Date.now();
  const signal = AbortSignal.timeout(options.timeoutMs ?? 15_000);
  try {
    const result = await models.classify(
      model,
      {
        state: { message: "Say OK." },
        questions: {
          ok: {
            type: "bool",
            instructions: "Does the message ask for a short reply?",
            criteria: { true: "It does.", false: "It does not." },
          },
        },
      },
      { signal },
    );
    const latencyMs = Date.now() - started;
    if (result.stopReason !== "stop") {
      return {
        ok: false,
        latencyMs,
        error: (result.errorMessage ?? `The call ended: ${result.stopReason}`).slice(0, 500),
      };
    }
    if (!result.answers.ok) {
      return { ok: false, latencyMs, error: "The classifier gave no answer." };
    }
    return { ok: true, latencyMs };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: (error instanceof Error ? error.message : String(error)).slice(0, 500),
    };
  }
}

/** Test a model of an account that isn't saved yet. */
export function testUnsavedModel(
  config: ModelConfig,
  credentials: CredentialResolver,
  providerId: string,
  upstreamId: string,
  options: { image?: boolean } = {},
): Promise<TestResult> {
  const models = createModels();
  for (const provider of buildProviders(config, credentials)) models.setProvider(provider);
  const model = models.getModel(providerId, upstreamId);
  if (!model) return Promise.resolve({ ok: false, latencyMs: 0, error: "The model isn't set up." });
  return testModelCall(models, model, options);
}
