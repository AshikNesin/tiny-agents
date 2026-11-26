import * as React from "react";
import { defaultFilter } from "cmdk";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { ChevronDown } from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "./command";
import { cn } from "./lib/utils";

export interface SearchSelectOption {
  value: string;
  label: string;
  description?: string;
  group?: string;
  keywords?: string[];
  icon?: React.ReactNode;
  disabled?: boolean;
}

interface SearchSelectAction {
  key: string;
  label: string;
  icon?: React.ReactNode;
  onSelect(query: string): void;
}

export interface SearchSelectProps {
  value: string;
  onValueChange(value: string): void;
  options: SearchSelectOption[];
  children?: React.ReactNode;
  label: string;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  actions?: SearchSelectAction[];
  createOption?: (query: string) => SearchSelectAction | null;
  align?: "start" | "center" | "end";
  side?: "top" | "bottom";
  contentClassName?: string;
  triggerClassName?: string;
  disabled?: boolean;
  searchable?: boolean;
  inlineDescriptions?: boolean;
  "data-testid"?: string;
}

function rankRows(value: string, search: string, keywords?: string[]): number {
  if (value.startsWith("__create__")) return 1;
  if (value.startsWith("__action__")) return 0.0001;
  return defaultFilter(value, search, keywords);
}

export const searchSelectTriggerClass =
  "text-muted-foreground hover:text-foreground hover:bg-muted aria-expanded:bg-muted aria-expanded:text-foreground focus-visible:ring-ring/50 inline-flex h-7 min-w-0 shrink items-center gap-1 rounded-lg px-2 text-xs font-medium outline-none select-none focus-visible:ring-3 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5";

export function SearchSelect({
  value,
  onValueChange,
  options,
  children,
  label,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyText = "Nothing found.",
  actions,
  createOption,
  align = "start",
  side = "bottom",
  contentClassName,
  triggerClassName,
  disabled,
  searchable = true,
  inlineDescriptions = false,
  "data-testid": testId,
}: SearchSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);
  const selected = options.find((o) => o.value === value);

  const groups = React.useMemo(() => {
    const map = new Map<string, SearchSelectOption[]>();
    for (const option of options) {
      const key = option.group ?? "";
      const list = map.get(key) ?? [];
      list.push(option);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [options]);

  const trimmed = query.trim();
  const create =
    createOption && trimmed && !options.some((o) => o.value === trimmed || o.label === trimmed)
      ? createOption(trimmed)
      : null;

  const close = () => {
    setOpen(false);
    setQuery("");
  };

  return (
    <PopoverPrimitive.Root
      open={open}
      onOpenChange={(next: boolean) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverPrimitive.Trigger
        type="button"
        disabled={disabled}
        aria-label={label}
        title={label}
        className={cn(searchSelectTriggerClass, triggerClassName)}
        data-testid={testId}
      >
        {children ?? (
          <>
            {selected?.icon}
            <span className="truncate">{selected?.label ?? placeholder}</span>
            <ChevronDown className="opacity-60" />
          </>
        )}
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Positioner
          align={align}
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className="z-50 outline-none"
        >
          <PopoverPrimitive.Popup
            initialFocus={searchable ? inputRef : undefined}
            className={cn(
              "w-72 max-w-[calc(100vw-1rem)] origin-(--transform-origin) overflow-hidden rounded-xl bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] data-[side=bottom]:slide-in-from-top-1 data-[side=top]:slide-in-from-bottom-1 outline-none data-closed:duration-100 data-closed:ease-in data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-[0.97] data-open:animate-in data-open:fade-in-0 data-open:zoom-in-[0.97]",
              contentClassName,
            )}
          >
            <Command
              loop
              filter={rankRows}
              className="rounded-none! p-0"
              defaultValue={selected ? `${selected.label} ${selected.value}` : undefined}
            >
              {searchable && (
                <CommandInput
                  ref={inputRef}
                  value={query}
                  onValueChange={setQuery}
                  placeholder={searchPlaceholder}
                  className="h-10"
                />
              )}
              <CommandList
                className={cn("max-h-80 p-1", !searchable && "border-t-0")}
                aria-label={label}
              >
                {!create && (
                  <CommandEmpty className="text-muted-foreground py-5 text-sm">
                    {emptyText}
                  </CommandEmpty>
                )}
                {groups.map(([heading, list], index) => (
                  <React.Fragment key={heading || "__ungrouped__"}>
                    {index > 0 && <CommandSeparator className="my-1" />}
                    <CommandGroup heading={heading || undefined} className="p-0">
                      {list.map((option) => (
                        <CommandItem
                          key={option.value}
                          value={`${option.label} ${option.value}`}
                          keywords={option.keywords}
                          disabled={option.disabled}
                          data-checked={option.value === value}
                          onSelect={() => {
                            onValueChange(option.value);
                            close();
                          }}
                          className={cn(
                            "h-auto min-h-8 py-1.5",
                            option.description && !inlineDescriptions && "items-start",
                          )}
                        >
                          {option.icon}
                          <span
                            className={cn(
                              "flex min-w-0 flex-1",
                              inlineDescriptions
                                ? "items-baseline justify-between gap-3"
                                : "flex-col",
                            )}
                          >
                            <span className="truncate">{option.label}</span>
                            {option.description && (
                              <span className="text-muted-foreground truncate text-xs">
                                {option.description}
                              </span>
                            )}
                          </span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </React.Fragment>
                ))}
                {(create || (actions && actions.length > 0)) && (
                  <>
                    {options.length > 0 && <CommandSeparator className="my-1" />}
                    <CommandGroup className="p-0" forceMount>
                      {create && (
                        <CommandItem
                          key={create.key}
                          value={`__create__ ${trimmed}`}
                          forceMount
                          onSelect={() => {
                            create.onSelect(trimmed);
                            close();
                          }}
                          className="h-8"
                        >
                          {create.icon}
                          <span className="truncate">{create.label}</span>
                        </CommandItem>
                      )}
                      {actions?.map((action) => (
                        <CommandItem
                          key={action.key}
                          value={`__action__ ${action.label}`}
                          forceMount
                          onSelect={() => {
                            action.onSelect(trimmed);
                            close();
                          }}
                          className="h-8"
                        >
                          {action.icon}
                          <span className="truncate">{action.label}</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </>
                )}
              </CommandList>
            </Command>
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
