/**
 * Classifiers (issue #65): small decision models that read a state plus typed
 * questions and return calibrated probabilities instead of text.
 *
 * pi-ai owns the System One wire format (Clef, Clef Flash, TypeSafe Jev, … on
 * Workers AI); this module only routes it through the Cloudflare AI Gateway
 * (Workers AI's `/ai/run` with `cf-aig-gateway-id`), on the same
 * `CLOUDFLARE_*` settings as chat models, so callers (the
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

/**
 * Default classifier model: TypeSafe's Jev, which runs through the gateway's
 * own balance. `@cf/…` models such as Clef bill through the gateway's Unified
 * Billing credits instead, and fail with 402 when the gateway has none.
 */
export const DEFAULT_CLASSIFIER_MODEL = "typesafe/jev";

const API_HOST = "https://api.cloudflare.com/client/v4";
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
 * System One on Workers AI's REST API, routed through the gateway:
 * `POST /accounts/{account}/ai/run` with `{ model, input }` and the
 * `cf-aig-gateway-id` header (Cloudflare's recommended gateway route; it serves
 * `@cf/…` and third-party models such as `typesafe/jev` alike, where the
 * gateway's provider-native `/workers-ai/{model}` route answered 402 for
 * `typesafe/jev`). Workers AI authenticates with `Authorization: Bearer`. The answer
 * comes in Workers AI's envelope: `{ success, result }`, where `result` is the
 * output (Clef) or a completed run wrapping it (Jev).
 */
const gatewayTransport: SystemOneTransport = {
  api: "cloudflare-workers-ai-system-one",
  label: LABEL,
  detectCompat: (model) => ({
    imageInput: model.id.startsWith("@cf/cloudflare/clef") ? "images" : "assets",
    sendImageOptInHeader: false,
  }),
  url: (model) => new URL(`${model.baseUrl}/run`),
  payload: (model, request) => ({ model: model.id, input: request }),
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
 * stay off). Calls send the token as `Authorization` (Workers AI) and as
 * `cf-aig-authorization` (for an authenticated gateway).
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
    baseUrl: `${API_HOST}/accounts/${encodeURIComponent(accountId)}/ai`,
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
          // Workers AI reads Authorization; the gateway (when authenticated) reads
          // cf-aig-authorization; cf-aig-gateway-id routes the call through it.
          resolve: async () => ({
            auth: {
              apiKey: key,
              headers: {
                Authorization: `Bearer ${key}`,
                "cf-aig-authorization": `Bearer ${key}`,
                "cf-aig-gateway-id": gatewayId,
              },
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
