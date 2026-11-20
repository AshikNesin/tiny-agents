import type { ClassifierAnswer, ClassifierContext } from "@earendil-works/pi-ai";
import type { Models } from "@earendil-works/pi-ai/models";
import type { ModelCatalog } from "@tiny-agents/models";

export type { ClassifierAnswer, ClassifierQuestion } from "@earendil-works/pi-ai";

export interface Classifier {
  readonly id: string;
  classify(
    context: ClassifierContext,
    signal?: AbortSignal,
  ): Promise<Record<string, ClassifierAnswer>>;
}

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
