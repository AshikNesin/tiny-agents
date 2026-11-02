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
import type { ModelInfo } from "../../lib/bots-api";

interface ModelSelectorProps {
  models: ModelInfo[];
  value: string;
  onChange: (modelId: string) => void;
  /** Model id kept even though it left the catalog. */
  unknownValue?: string;
  id?: string;
}

const FAMILY_LABEL: Record<ModelInfo["family"], string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  "workers-ai": "Workers AI",
  other: "Other",
};

/** AI Elements Model Selector: a grouped model picker (issue #1 D17). */
export function ModelSelector({ models, value, onChange, unknownValue, id }: ModelSelectorProps) {
  const selected = models.find((m) => m.id === value);
  // With more than one provider (e.g. the gateway and OpenAI direct) the
  // same model can be listed twice; the group label names the provider.
  const multiProvider = new Set(models.map((m) => m.provider ?? "")).size > 1;
  const groups = new Map<string, ModelInfo[]>();
  for (const model of models) {
    const label =
      multiProvider && model.provider
        ? `${FAMILY_LABEL[model.family]} · ${model.provider}`
        : FAMILY_LABEL[model.family];
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
                <DropdownMenuItem key={model.id} onSelect={() => onChange(model.id)}>
                  {model.id === value ? <Check className="size-4" /> : <span className="size-4" />}
                  <span className="truncate">{model.name}</span>
                  {model.reasoning ? (
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
