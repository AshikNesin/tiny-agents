/**
 * Image transcription side-call: sends an image to a vision-capable model
 * and returns the text. Port of the dotfiles `vision` CLI
 * (`~/dotfiles/bin/vision`): same system prompt, same default question,
 * one retry on 429/5xx, fail by throwing (the tool converts to fail-open).
 *
 * The model is the `vision` model role (issue #179): the one set in
 * Settings → Models, else the first available model that sees images. A
 * direct vision endpoint is just another provider account. None available
 * throws "no vision model is configured".
 */
import type { Api, AssistantMessage, Context, Model, UserMessage } from "@earendil-works/pi-ai";
import type { ModelCatalog } from "../model-catalog";

/** Transcription prompts, reused verbatim from the dotfiles CLI. */
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
  /** Transcribe one image. `question` defaults to the full-transcription prompt. */
  transcribe(
    image: TranscribeImage,
    options?: { question?: string; timeoutMs?: number },
  ): Promise<string>;
  /** The vision model the transcriber uses right now (row id), if any. */
  modelId(): string | undefined;
}

/** The minimum the transcriber needs: the runtime's catalog and registry. */
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
      // The side-call exists to send an image; if the registry declared the
      // model text-only, pi-ai's transform would strip the image block
      // before the wire. Declare it on the call's copy so the image survives.
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
        // Empty answers can be a transient upstream quirk: retry once.
        if (!text) throw new UpstreamError(`empty answer from ${role.name}`, true);
        return text;
      });
    },
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
