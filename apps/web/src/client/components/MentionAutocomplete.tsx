import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from "react";
import { cn } from "@groot/ui/lib/utils";
import { BotAvatar } from "./BotAvatar";

export interface MentionableBot {
  id: string;
  name: string;
  description: string;
}

interface MentionAutocompleteProps {
  bots: MentionableBot[];
  query: string;
  onSelect: (bot: MentionableBot) => void;
  onClose: () => void;
  ref?: Ref<MentionAutocompleteHandle>;
  label?: string;
  icon?: (item: MentionableBot) => ReactNode;
  filtered?: boolean;
}

export interface MentionAutocompleteHandle {
  handleKeyDown(event: KeyboardEvent): boolean;
}

export function MentionAutocomplete({
  bots,
  query,
  onSelect,
  onClose,
  ref,
  label = "Mention a bot",
  icon = (bot) => <BotAvatar name={bot.name} className="size-8" />,
  filtered = false,
}: MentionAutocompleteProps) {
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => {
    if (filtered) return bots;
    const q = query.toLowerCase();
    return bots.filter((bot) => bot.name.toLowerCase().startsWith(q));
  }, [bots, query, filtered]);

  useEffect(() => {
    setSelected(0);
  }, [query]);
  useEffect(() => {
    setSelected((i) => Math.min(i, Math.max(0, matches.length - 1)));
  }, [matches.length]);

  useLayoutEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>("[data-selected=true]")
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const pick = (bot: MentionableBot) => {
    onSelect(bot);
    onClose();
  };

  const handleKeyDown = (e: KeyboardEvent): boolean => {
    if (matches.length === 0) return false;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((i) => (i + 1) % matches.length);
      return true;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((i) => (i - 1 + matches.length) % matches.length);
      return true;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      pick(matches[selected]!);
      return true;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return true;
    }
    return false;
  };

  useImperativeHandle(ref, () => ({ handleKeyDown }), [matches, selected]);

  if (matches.length === 0) return null;

  return (
    <div
      role="listbox"
      aria-label={label}
      className="bg-popover text-popover-foreground absolute bottom-full left-0 z-50 mb-2 w-full overflow-hidden rounded-xl border shadow-lg"
    >
      <div ref={listRef} className="max-h-60 overflow-y-auto p-1">
        {matches.map((bot, i) => {
          const active = i === selected;
          return (
            <button
              key={bot.id}
              type="button"
              role="option"
              aria-selected={active}
              data-selected={active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(bot)}
              onMouseEnter={() => setSelected(i)}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left",
                active ? "bg-muted" : "hover:bg-muted/50",
              )}
            >
              {icon(bot)}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{bot.name}</span>
                {bot.description && (
                  <span className="text-muted-foreground block truncate text-xs">
                    {bot.description}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
