/**
 * A searchable model picker (issue #215): a form-sized trigger over
 * `SearchSelect`, options grouped by provider account. Used wherever a model
 * is chosen from a list that can be long (a gateway lists hundreds).
 */
import { useMemo } from "react";
import { ChevronsUpDown } from "lucide-react";
import { cn } from "@groot/ui/lib/utils";
import { SearchSelect, type SearchSelectOption } from "./ui/search-select";

export interface ModelPickerOption {
  id: string;
  /** The model's name. */
  label: string;
  /** The provider account's name: the group heading. */
  group?: string;
  /** Muted right-hand note (context size, "uses your Claude plan", why it can't run). */
  description?: string;
  /** Extra words the search matches (the upstream id). */
  keywords?: string[];
  disabled?: boolean;
}

/** Looks like the form `Select`, so it sits in forms and tables alike. */
const formTriggerClass =
  "h-9 w-full justify-between gap-1.5 rounded-xl border border-input bg-transparent px-3 text-sm font-normal text-foreground hover:bg-transparent dark:bg-input/30 dark:hover:bg-input/50 aria-expanded:bg-transparent [&_svg:not([class*='size-'])]:size-4";

export function ModelPicker({
  value,
  options,
  onChange,
  label,
  placeholder = "Choose a model",
  id,
  className,
  showGroup = true,
}: {
  value: string;
  options: ModelPickerOption[];
  onChange: (modelId: string) => void;
  /** Accessible name of the trigger. */
  label: string;
  /** Shown when no option is selected. */
  placeholder?: string;
  id?: string;
  className?: string;
  /** Prefix the selected model with its account ("Gateway / Claude Sonnet 5.5"). */
  showGroup?: boolean;
}) {
  const selected = options.find((option) => option.id === value);
  // Stable across re-renders, so an open list isn't rebuilt under the pointer.
  const items: SearchSelectOption[] = useMemo(
    () =>
      options.map((option) => ({
        value: option.id,
        label: option.label,
        ...(option.group ? { group: option.group } : {}),
        ...(option.description ? { description: option.description } : {}),
        keywords: [option.group ?? "", ...(option.keywords ?? [])],
        ...(option.disabled ? { disabled: true } : {}),
      })),
    [options],
  );
  return (
    <SearchSelect
      value={value}
      onValueChange={onChange}
      options={items}
      label={label}
      searchPlaceholder="Search models…"
      emptyText="No model matches."
      contentClassName="w-80"
      triggerClassName={cn(formTriggerClass, className)}
      {...(id ? { "data-testid": id } : {})}
    >
      <span className={cn("truncate", !selected && "text-muted-foreground")}>
        {selected
          ? `${showGroup && selected.group ? `${selected.group} / ` : ""}${selected.label}`
          : placeholder}
      </span>
      <ChevronsUpDown className="text-muted-foreground" />
    </SearchSelect>
  );
}
