import type { Api, AssistantMessage, Context, Model, UserMessage } from "@earendil-works/pi-ai";
import type { ModelCatalog } from "@tiny-agents/models";

const VISION_SYSTEM =
  "You are a vision transcription service for an agent that cannot see images. " +
  "Answer the question about the image with high fidelity. Always transcribe text verbatim. " +
  "Prefer specifics (exact strings, positions like 'top-left', colors) over generalities. " +
  "Never refuse to describe what is visible, and never invent content that is not there.";

const DEFAULT_QUESTION =
  "Describe this image precisely and completely. Transcribe any visible text EXACTLY as written " +
  "(error messages, labels, filenames, code), then describe the layout, positions, and colors. " +
  "Be factual; do not speculate beyond what is visible.";

interface TranscribeImage {
  data: string;
  mimeType: string;
  name: string;
  width?: number;
  height?: number;
}

export interface Transcriber {
  transcribe(
    image: TranscribeImage,
    options?: { question?: string; timeoutMs?: number },
  ): Promise<string>;
  modelId(): string | undefined;
}

export interface TranscriberSource {
  catalog(): Pick<ModelCatalog, "forRole" | "piModel">;
  models: {
    completeSimple(
      model: Model<Api>,
      context: Context,
      options?: { maxTokens?: number },
    ): Promise<AssistantMessage>;
  };
}

const DEFAULT_TIMEOUT_MS = 90_000;

export function createTranscriber(source: TranscriberSource): Transcriber {
  const chosen = () => source.catalog().forRole("vision");
  return {
    modelId: () => chosen()?.id,
    transcribe: async (image, call = {}) => {
      const question = call.question?.trim() || DEFAULT_QUESTION;
      const timeoutMs = call.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const role = chosen();
      const resolved = role ? source.catalog().piModel(role.id) : undefined;
      if (!role || !resolved) {
        throw new Error(
          "no vision model is configured (set the vision model in Settings → Models)",
        );
      }
      const model: Model<Api> = (resolved.input ?? []).includes("image")
        ? resolved
        : { ...resolved, input: [...(resolved.input ?? ["text"]), "image"] };
      return retry(async () => {
        const message = await withTimeout(
          source.models.completeSimple(
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
          `vision model ${role.name}`,
        );
        const text = textOf(message);
        if (!text) throw new UpstreamError(`empty answer from ${role.name}`, true);
        return text;
      });
    },
  };
}

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
