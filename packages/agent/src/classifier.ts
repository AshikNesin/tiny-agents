/**
 * Classifiers (issue #65): small decision models that read a state plus typed
 * questions and return calibrated probabilities instead of text.
 *
 * pi-ai owns the wire formats (Clef, Clef Flash, TypeSafe Jev, … on Workers
 * AI); this module only picks the model and its credentials, so callers (the
 * auto-reviewer, later checks) depend on `Classifier` and never on a provider.
 * Another model is a `CLASSIFIER_MODEL` change, not new code.
 */
import type {
  ClassifierAnswer,
  ClassifierApi,
  ClassifierContext,
  ClassifierModel,
} from "@earendil-works/pi-ai";
import { createModels, type Models } from "@earendil-works/pi-ai/models";
import { cloudflareWorkersAIProvider } from "@earendil-works/pi-ai/providers/cloudflare-workers-ai";

export type {
  ClassifierAnswer,
  ClassifierContext,
  ClassifierQuestion,
} from "@earendil-works/pi-ai";

/** The Workers AI provider classifiers run on (direct, so the free allocation applies). */
export const CLASSIFIER_PROVIDER = "cloudflare-workers-ai";

/** Default classifier model: Cloudflare's Clef. */
export const DEFAULT_CLASSIFIER_MODEL = "@cf/cloudflare/clef";

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

/**
 * A classifier over a pi-ai model registry (tests pass a faux one).
 * `headers` go on every request (e.g. the AI Gateway route).
 */
export function classifierFromModels(
  models: Models,
  model: ClassifierModel<ClassifierApi>,
  headers?: Record<string, string>,
): Classifier {
  return {
    id: `${model.provider}/${model.id}`,
    async classify(context, signal) {
      const result = await models.classify(model, context, {
        ...(signal ? { signal } : {}),
        ...(headers ? { headers } : {}),
      });
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

/**
 * The configured classifier, or `undefined` when its credentials are missing
 * or `CLASSIFIER_MODEL` names an unknown model (features using it stay off).
 *
 * Calls go to Workers AI with `CLASSIFIER_API_KEY`, else `CLOUDFLARE_API_KEY`
 * (the token needs Workers AI permission), on `CLOUDFLARE_ACCOUNT_ID`.
 * They are logged by the AI Gateway `classifierGateway()` names; `off` (or
 * no gateway id) calls Workers AI directly.
 */
export function createClassifier(env: Env = process.env): Classifier | undefined {
  const credential = unquote(env.CLASSIFIER_API_KEY) ?? unquote(env.CLOUDFLARE_API_KEY);
  const accountId = unquote(env.CLOUDFLARE_ACCOUNT_ID);
  if (!credential || !accountId) return undefined;
  const modelId = unquote(env.CLASSIFIER_MODEL) ?? DEFAULT_CLASSIFIER_MODEL;
  // The Workers AI provider reads these names; the key may come from CLASSIFIER_API_KEY.
  const values = new Map([
    ["CLOUDFLARE_API_KEY", credential],
    ["CLOUDFLARE_ACCOUNT_ID", accountId],
  ]);
  const models = createModels({
    authContext: { env: async (name) => values.get(name), fileExists: async () => false },
  });
  models.setProvider(cloudflareWorkersAIProvider());
  const model = models.getModelOfType("classifier", CLASSIFIER_PROVIDER, modelId);
  if (!model) {
    console.warn(
      `[tiny-agents] CLASSIFIER_MODEL "${modelId}" is not a ${CLASSIFIER_PROVIDER} classifier — auto-review is off.`,
    );
    return undefined;
  }
  return classifierFromModels(models, model, gatewayHeaders(env));
}

/**
 * The AI Gateway classifier calls go through: `CLASSIFIER_GATEWAY_ID`, else
 * the chat models' `CLOUDFLARE_GATEWAY_ID`; `undefined` for `off` or none.
 */
function classifierGateway(env: Env): string | undefined {
  const id = unquote(env.CLASSIFIER_GATEWAY_ID) ?? unquote(env.CLOUDFLARE_GATEWAY_ID);
  return id && id.toLowerCase() !== "off" ? id : undefined;
}

/**
 * Workers AI's REST endpoint routes through a gateway named by
 * `cf-aig-gateway-id`. An authenticated gateway also wants its own token
 * (`CLOUDFLARE_API_KEY`, as for chat models) in `cf-aig-authorization`;
 * `Authorization` stays the Workers AI token.
 */
function gatewayHeaders(env: Env): Record<string, string> | undefined {
  const gateway = classifierGateway(env);
  if (!gateway) return undefined;
  const gatewayKey = unquote(env.CLOUDFLARE_API_KEY);
  return {
    "cf-aig-gateway-id": gateway,
    ...(gatewayKey ? { "cf-aig-authorization": `Bearer ${gatewayKey}` } : {}),
  };
}
