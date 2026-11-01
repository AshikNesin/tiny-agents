/**
 * Classifiers (issue #65): small decision models that read a state plus typed
 * questions and return calibrated probabilities instead of text.
 *
 * pi-ai owns the System One wire format (Clef, Clef Flash, TypeSafe Jev, … on
 * Workers AI); this module only routes it through the Cloudflare AI Gateway,
 * on the same `CLOUDFLARE_*` settings as chat models, so callers (the
 * auto-reviewer, later checks) depend on `Classifier` and never on a
 * provider. Another model is a `CLASSIFIER_MODEL` change, not new code.
 */
import type {
  ClassifierAnswer,
  ClassifierApi,
  ClassifierContext,
  ClassifierModel,
} from "@earendil-works/pi-ai";
import {
  classifySystemOne,
  type SystemOneTransport,
} from "@earendil-works/pi-ai/api/system-one-shared";
import { createModels, createProvider, type Models } from "@earendil-works/pi-ai/models";
import { CLOUDFLARE_WORKERS_AI_CLASSIFIER_MODELS } from "@earendil-works/pi-ai/providers/cloudflare-workers-ai.models";

export type {
  ClassifierAnswer,
  ClassifierContext,
  ClassifierQuestion,
} from "@earendil-works/pi-ai";

/** The provider id classifier calls are registered under (and logged with). */
export const CLASSIFIER_PROVIDER = "cloudflare-ai-gateway";

/** Default classifier model: Cloudflare's Clef. */
export const DEFAULT_CLASSIFIER_MODEL = "@cf/cloudflare/clef";

const GATEWAY_HOST = "https://gateway.ai.cloudflare.com";
const LABEL = "Cloudflare AI Gateway (Workers AI)";

export interface Classifier {
  /** `<provider>/<model>`, for logs and memoized verdicts. */
  readonly id: string;
  /** One answer per question id. Throws on a failed, aborted or incomplete call. */
  classify(
    context: ClassifierContext,
    signal?: AbortSignal,
  ): Promise<Record<string, ClassifierAnswer>>;
}

type Env = Readonly<Record<string, string | undefined>>;

const unquote = (value: string | undefined) =>
  value
    ?.trim()
    .replace(/^(['"])([\s\S]*)\1$/, "$2")
    .trim() || undefined;

/** A classifier over a pi-ai model registry (tests pass a faux one). */
export function classifierFromModels(
  models: Models,
  model: ClassifierModel<ClassifierApi>,
): Classifier {
  return {
    id: `${model.provider}/${model.id}`,
    async classify(context, signal) {
      const result = await models.classify(model, context, signal ? { signal } : {});
      if (result.stopReason !== "stop") {
        throw new Error(result.errorMessage ?? `Classifier ${result.stopReason}`);
      }
      for (const id of Object.keys(context.questions)) {
        if (!result.answers[id]) throw new Error(`Classifier gave no answer for "${id}"`);
      }
      return result.answers;
    },
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * System One on the gateway's Workers AI route:
 * `POST /v1/{account}/{gateway}/workers-ai/{model}` with the System One request
 * as the body. The answer comes in Workers AI's envelope: `{ success, result }`,
 * where `result` is the output (Clef) or a completed run wrapping it (Jev).
 */
const gatewayTransport: SystemOneTransport = {
  api: "cloudflare-workers-ai-system-one",
  label: LABEL,
  detectCompat: (model) => ({
    imageInput: model.id.startsWith("@cf/cloudflare/clef") ? "images" : "assets",
    sendImageOptInHeader: false,
  }),
  url: (model) => new URL(`${model.baseUrl}/${model.id}`),
  payload: (_model, request) => request,
  output: (body) => {
    if (!isRecord(body)) throw new Error(`${LABEL} returned an unexpected response`);
    if (body.success === false) {
      const messages = Array.isArray(body.errors)
        ? body.errors.flatMap((e) =>
            isRecord(e) && typeof e.message === "string" ? [e.message] : [],
          )
        : [];
      throw new Error(
        messages.length ? `${LABEL} error: ${messages.join("; ")}` : `${LABEL} request failed`,
      );
    }
    const result = body.result;
    if (!isRecord(result)) throw new Error(`${LABEL} returned an unexpected response`);
    if ("answers" in result) return result;
    if (result.state !== "Completed") {
      throw new Error(`${LABEL} run did not complete (state: ${String(result.state)})`);
    }
    if (!isRecord(result.result)) throw new Error(`${LABEL} returned an unexpected response`);
    return result.result;
  },
};

/**
 * The configured classifier, or `undefined` when the AI Gateway settings
 * (`CLOUDFLARE_API_KEY`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_GATEWAY_ID`)
 * are missing or `CLASSIFIER_MODEL` names an unknown model (features using it
 * stay off). Calls authenticate to the gateway with `cf-aig-authorization`,
 * as chat models do.
 */
export function createClassifier(env: Env = process.env): Classifier | undefined {
  const key = unquote(env.CLOUDFLARE_API_KEY);
  const accountId = unquote(env.CLOUDFLARE_ACCOUNT_ID);
  const gatewayId = unquote(env.CLOUDFLARE_GATEWAY_ID);
  if (!key || !accountId || !gatewayId) return undefined;
  const modelId = unquote(env.CLASSIFIER_MODEL) ?? DEFAULT_CLASSIFIER_MODEL;
  const known = Object.values(
    CLOUDFLARE_WORKERS_AI_CLASSIFIER_MODELS as Record<string, ClassifierModel<ClassifierApi>>,
  ).find((candidate) => candidate.id === modelId);
  if (!known) {
    console.warn(
      `[tiny-agents] CLASSIFIER_MODEL "${modelId}" is not a Workers AI classifier — auto-review is off.`,
    );
    return undefined;
  }
  const model: ClassifierModel<ClassifierApi> = {
    ...known,
    provider: CLASSIFIER_PROVIDER,
    baseUrl: `${GATEWAY_HOST}/v1/${encodeURIComponent(accountId)}/${encodeURIComponent(gatewayId)}/workers-ai`,
  };
  const models = createModels({
    authContext: { env: async () => undefined, fileExists: async () => false },
  });
  models.setProvider(
    createProvider({
      id: CLASSIFIER_PROVIDER,
      name: "Cloudflare AI Gateway",
      auth: {
        apiKey: {
          name: "Cloudflare AI Gateway token",
          // The gateway's native scheme: its token in cf-aig-authorization, no Authorization.
          resolve: async () => ({
            auth: {
              apiKey: key,
              headers: { "cf-aig-authorization": `Bearer ${key}`, Authorization: null },
            },
            source: "CLOUDFLARE_API_KEY",
          }),
        },
      },
      models: [model],
      classifiers: {
        "cloudflare-workers-ai-system-one": {
          classify: (m, context, options) =>
            classifySystemOne(gatewayTransport, m, context, options),
        },
      },
    }),
  );
  return classifierFromModels(models, model);
}
