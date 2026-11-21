import { useMemo } from "react";
import { ChevronsUpDown } from "lucide-react";
import { cn } from "@groot/ui/lib/utils";
import { SearchSelect, type SearchSelectOption } from "./ui/search-select";

export interface ModelPickerOption {
  id: string;
  label: string;
  group?: string;
  description?: string;
  keywords?: string[];
  disabled?: boolean;
}

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
  label: string;
  placeholder?: string;
  id?: string;
  className?: string;
  showGroup?: boolean;
}) {
  const selected = options.find((option) => option.id === value);
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
