import type { CatalogModel } from "../../../shared/api/models";
import { ModelPicker } from "../ModelPicker";

interface ModelSelectorProps {
  models: CatalogModel[];
  value: string;
  onChange: (modelId: string) => void;
  unknownValue?: string;
  id?: string;
}

export const UNAVAILABLE_LABEL: Record<NonNullable<CatalogModel["unavailableReason"]>, string> = {
  disabled: "account off",
  locked: "re-enter key",
  missing: "no longer listed",
  provider_failing: "account failing",
};

function modelNote(model: CatalogModel): string | undefined {
  if (model.unavailableReason) return UNAVAILABLE_LABEL[model.unavailableReason];
  return model.note ?? (model.reasoning ? "reasoning" : undefined);
}

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
      label={options.find((o) => o.id === value)?.label ?? "Model"}
      showGroup={false}
      {...(id ? { id } : {})}
    />
  );
}
