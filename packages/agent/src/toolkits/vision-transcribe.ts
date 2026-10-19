/**
 * Image transcription side-call: sends an image to a vision-capable model
 * and returns the text. Port of the dotfiles `vision` CLI
 * (`~/dotfiles/bin/vision`): same system prompt, same default question,
 * one retry on 429/5xx, fail by throwing (the tool converts to fail-open).
 *
 * Transcriber selection, in order:
 * 1. VISION_MODEL env (gateway catalog id, or "custom:<provider>/<model>").
 * 2. The first vision-capable gateway model, workers-ai first (cheap).
 * 3. VISION_BASE_URL + VISION_API_KEY (OpenAI-compatible direct backend,
 *    for setups with no vision model on the gateway).
 * None available throws "no vision model is configured".
 */
import type { Api, AssistantMessage, Context, Model, UserMessage } from "@earendil-works/pi-ai";

/** Transcription prompts, reused verbatim from the dotfiles CLI. */
export const VISION_SYSTEM =
  "You are a vision transcription service for an agent that cannot see images. " +
  "Answer the question about the image with high fidelity. Always transcribe text verbatim. " +
  "Prefer specifics (exact strings, positions like 'top-left', colors) over generalities. " +
  "Never refuse to describe what is visible, and never invent content that is not there.";

export const DEFAULT_QUESTION =
  "Describe this image precisely and completely. Transcribe any visible text EXACTLY as written " +
  "(error messages, labels, filenames, code), then describe the layout, positions, and colors. " +
  "Be factual; do not speculate beyond what is visible.";

export interface TranscribeImage {
  data: string;
  mimeType: string;
  name: string;
  width?: number;
  height?: number;
}

export interface Transcriber {
  /** Transcribe one image. `question` defaults to the full-transcription prompt. */
  transcribe(
    image: TranscribeImage,
    options?: { question?: string; timeoutMs?: number },
  ): Promise<string>;
  /** The transcriber model ids available right now (first is the default). */
  availableModelIds(): string[];
}

/** The minimum the transcriber needs from a pi-ai model registry. */
export type TranscriberModels = {
  getModel(provider: string, id: string): Model<Api> | undefined;
  getProviders(): readonly { id: string }[];
  getModels(provider: string): readonly Model<Api>[];
  completeSimple(
    model: Model<Api>,
    context: Context,
    options?: { maxTokens?: number },
  ): Promise<AssistantMessage>;
};

const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const DEFAULT_TIMEOUT_MS = 90_000;

export function createTranscriber(
  models: TranscriberModels,
  options: {
    providerId: string;
    env?: Readonly<Record<string, string | undefined>>;
  },
): Transcriber {
  const env = options.env ?? process.env;
  const directBase = env.VISION_BASE_URL?.trim();
  const directKey = env.VISION_API_KEY?.trim();

  const resolveCatalog = (modelId: string): Model<Api> | undefined => {
    if (modelId.startsWith("custom:")) {
      const rest = modelId.slice("custom:".length);
      const slash = rest.indexOf("/");
      return slash > 0 ? models.getModel(rest.slice(0, slash), rest.slice(slash + 1)) : undefined;
    }
    return models.getModel(options.providerId, modelId);
  };

  const catalogVisionIds = (): string[] => {
    const ids: string[] = [];
    for (const provider of models.getProviders()) {
      for (const model of models.getModels(provider.id)) {
        if (!(model.input ?? []).includes("image")) continue;
        ids.push(
          provider.id === options.providerId ? model.id : `custom:${provider.id}/${model.id}`,
        );
      }
    }
    // workers-ai image models are the cheap gateway-served default; first.
    return ids.sort(
      (a, b) => Number(b.startsWith("workers-ai/")) - Number(a.startsWith("workers-ai/")),
    );
  };

  const chosenModelId = (): string | undefined => {
    const explicit = env.VISION_MODEL?.trim();
    if (explicit && resolveCatalog(explicit)) return explicit;
    if (explicit && !directBase) return undefined; // configured but gone: do not silently pick another
    return catalogVisionIds()[0];
  };

  return {
    transcribe: async (image, call = {}) => {
      const question = call.question?.trim() || DEFAULT_QUESTION;
      const timeoutMs = call.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const modelId = chosenModelId();
      if (modelId) {
        const model = resolveCatalog(modelId);
        if (model) {
          const answer = await retry(async () => {
            const message = await withTimeout(
              models.completeSimple(
                model,
                {
                  systemPrompt: VISION_SYSTEM,
                  messages: [
                    {
                      role: "user",
                      content: [
                        { type: "image", data: image.data, mimeType: image.mimeType },
                        { type: "text", text: question },
                      ],
                      timestamp: Date.now(),
                    } as UserMessage,
                  ],
                },
                { maxTokens: 16_384 },
              ),
              timeoutMs,
              `vision model ${modelId}`,
            );
            const text = textOf(message);
            if (!text) throw new UpstreamError(`empty answer from ${modelId}`, false);
            return text;
          });
          return answer;
        }
      }
      if (directBase) {
        const body = {
          model: env.VISION_MODEL?.trim() || "gpt-5.6-luna",
          messages: [
            { role: "system", content: VISION_SYSTEM },
            {
              role: "user",
              content: [
                {
                  type: "image_url",
                  image_url: { url: `data:${image.mimeType};base64,${image.data}` },
                },
                { type: "text", text: question },
              ],
            },
          ],
          max_completion_tokens: 16_384,
        };
        return retry(async () => {
          const text = await withTimeout(
            directChat(directBase, directKey, body),
            timeoutMs,
            "vision backend",
          );
          if (!text) throw new UpstreamError("empty answer from vision backend", false);
          return text;
        });
      }
      throw new Error(
        "no vision model is configured (set VISION_MODEL, or add a vision model to the gateway, or set VISION_BASE_URL)",
      );
    },
    availableModelIds: () =>
      directBase ? [...catalogVisionIds(), `${directBase} (direct)`] : catalogVisionIds(),
  };
}

/** A thrown error that knows whether a retry can help. */
class UpstreamError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
  }
}

async function retry<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const retryable =
      error instanceof UpstreamError ? error.retryable : /HTTP (429|5\d\d)/.test(String(error));
    if (!retryable) throw error;
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return work();
  }
}

async function directChat(
  baseUrl: string,
  apiKey: string | undefined,
  body: unknown,
): Promise<string> {
  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 200);
    throw new UpstreamError(
      `HTTP ${response.status} from vision backend: ${detail}`,
      RETRYABLE.has(response.status),
    );
  }
  const payload = (await response.json()) as {
    choices?: { message?: { content?: string | { text?: string }[] } }[];
  };
  const content = payload.choices?.[0]?.message?.content;
  return typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((block) => block.text ?? "").join("")
      : "";
}

function textOf(message: AssistantMessage): string {
  return message.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}

async function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new UpstreamError(`timeout after ${Math.round(ms / 1000)}s talking to ${what}`, false),
        ),
      ms,
    );
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}
