import type { CatalogModel } from "../../lib/bots-api";
import { ModelPicker } from "../ModelPicker";

interface ModelSelectorProps {
  models: CatalogModel[];
  value: string;
  onChange: (modelId: string) => void;
  /** Model id kept even though it left the catalog. */
  unknownValue?: string;
  id?: string;
}

/** Why a model can't run now, as the picker says it. */
export const UNAVAILABLE_LABEL: Record<NonNullable<CatalogModel["unavailableReason"]>, string> = {
  disabled: "account off",
  locked: "re-enter key",
  missing: "no longer listed",
  provider_failing: "account failing",
};

/** The note beside a model in a picker: why it can't run, or what it is. */
function modelNote(model: CatalogModel): string | undefined {
  if (model.unavailableReason) return UNAVAILABLE_LABEL[model.unavailableReason];
  return model.note ?? (model.reasoning ? "reasoning" : undefined);
}

/**
 * The bot's model picker (issue #1 D17), searchable (issue #215) and grouped
 * by provider account (issue #179): the same model can be offered by two
 * accounts, and the group names which. Disabled models stay only while
 * selected; ones that can't run are greyed out with the reason.
 */
export function ModelSelector({ models, value, onChange, unknownValue, id }: ModelSelectorProps) {
  const known = models.some((m) => m.id === value);
  const options = [
    ...(unknownValue && !known
      ? [{ id: unknownValue, label: `${unknownValue} (no longer available)` }]
      : []),
    ...models
      .filter((m) => m.enabled || m.id === value)
      .map((m) => ({
        id: m.id,
        label: m.name,
        group: m.providerName,
        keywords: [m.upstreamId],
        disabled: !m.available,
        ...(modelNote(m) ? { description: modelNote(m)! } : {}),
      })),
  ];
  return (
    <ModelPicker
      value={value}
      options={options}
      onChange={onChange}
      // Named by the selected model, as the picker shows it.
      label={options.find((o) => o.id === value)?.label ?? "Model"}
      showGroup={false}
      {...(id ? { id } : {})}
    />
  );
}
