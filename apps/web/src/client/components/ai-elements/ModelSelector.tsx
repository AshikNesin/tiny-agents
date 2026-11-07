import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@groot/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@groot/ui/dropdown-menu";
import type { CatalogModel } from "../../lib/bots-api";

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

/** AI Elements Model Selector: a grouped model picker (issue #1 D17). */
export function ModelSelector({ models, value, onChange, unknownValue, id }: ModelSelectorProps) {
  const selected = models.find((m) => m.id === value);
  // Grouped by provider account (issue #179): the same model can be offered
  // by two accounts, and the group names which. Disabled models stay only
  // while selected.
  const groups = new Map<string, CatalogModel[]>();
  for (const model of models) {
    if (!model.enabled && model.id !== value) continue;
    const label = model.providerName;
    const list = groups.get(label) ?? [];
    list.push(model);
    groups.set(label, list);
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="w-full justify-between font-normal" id={id}>
          <span className="truncate">
            {selected?.name ?? unknownValue ?? value}
            {unknownValue && !selected ? " (no longer available)" : ""}
          </span>
          <ChevronsUpDown className="text-muted-foreground size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 w-64 overflow-y-auto">
        {unknownValue && !selected && (
          <>
            <DropdownMenuItem onSelect={() => onChange(unknownValue)}>
              <Check className="size-4" /> {unknownValue}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        {[...groups.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([label, groupModels]) => (
            <DropdownMenuGroup key={label}>
              <DropdownMenuLabel>{label}</DropdownMenuLabel>
              {groupModels.map((model) => (
                <DropdownMenuItem
                  key={model.id}
                  disabled={!model.available}
                  onSelect={() => onChange(model.id)}
                >
                  {model.id === value ? <Check className="size-4" /> : <span className="size-4" />}
                  <span className="truncate">{model.name}</span>
                  {model.unavailableReason ? (
                    <span className="text-muted-foreground ml-auto text-xs">
                      {UNAVAILABLE_LABEL[model.unavailableReason]}
                    </span>
                  ) : model.note ? (
                    <span className="text-muted-foreground ml-auto text-xs">{model.note}</span>
                  ) : model.reasoning ? (
                    <span className="text-muted-foreground ml-auto text-xs">reasoning</span>
                  ) : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
