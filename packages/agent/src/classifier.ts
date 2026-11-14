/**
 * Classifiers (issue #65): small decision models that read a state plus typed
 * questions and return calibrated probabilities instead of text.
 *
 * pi-ai owns the System One wire format (Clef, Clef Flash, TypeSafe Jev, … on
 * Workers AI); the classifier model is the `classifier` model role (issue
 * #179), a classifier row of a Cloudflare AI Gateway account, resolved on
 * every call so a change in Settings → Models applies at once. Callers (the
 * auto-reviewer, later checks) depend on `Classifier` and never on a
 * provider.
 */
import type { ClassifierAnswer, ClassifierContext } from "@earendil-works/pi-ai";
import type { Models } from "@earendil-works/pi-ai/models";
import type { ModelCatalog } from "@tiny-agents/models";

export type { ClassifierAnswer, ClassifierQuestion } from "@earendil-works/pi-ai";

export interface Classifier {
  /** The classifier model's row id, for logs and memoized verdicts ("none" when unset). */
  readonly id: string;
  /**
   * One answer per question id. Throws on a failed, aborted or incomplete
   * call, and when no classifier role is set.
   */
  classify(
    context: ClassifierContext,
    signal?: AbortSignal,
  ): Promise<Record<string, ClassifierAnswer>>;
}

/** The classifier role's model on the runtime's registry, resolved per call. */
export function createClassifier(source: {
  catalog(): ModelCatalog;
  models: Pick<Models, "classify">;
}): Classifier {
  const current = () => source.catalog().forRole("classifier");
  return {
    get id() {
      return current()?.id ?? "none";
    },
    async classify(context, signal) {
      const role = current();
      const model = role ? source.catalog().classifierModel(role.id) : undefined;
      if (!model) throw new Error("No classifier model is set (Settings → Models).");
      const result = await source.models.classify(model, context, signal ? { signal } : {});
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
