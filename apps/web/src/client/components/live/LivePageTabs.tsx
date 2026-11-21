import { Hand } from "lucide-react";
import { cn } from "@groot/ui/lib/utils";
import type { LiveViewKind } from "../../lib/live-view";
import type { LivePageSurface, PageItem } from "./surface";

function usersOf(item: PageItem, own: string): string {
  if (item.profile !== "shared") return own;
  const count = item.bots.length;
  return count === 0 ? "no bots yet" : count === 1 ? item.bots[0]!.name : `${count} bots`;
}

export function driverOf(item: PageItem): string {
  if (item.driver === "human") return "You're driving";
  if (item.profile !== "shared") return `${item.label} is driving`;
  return item.bots.length === 1 ? `${item.bots[0]!.name} is driving` : "Bots are driving";
}

export function LivePageTabs<L, I extends PageItem>({
  kind,
  page,
  items,
  profile,
  onSelect,
}: {
  kind: LiveViewKind;
  page: LivePageSurface<L, I>;
  items: I[];
  profile: string | undefined;
  onSelect: (profile: string) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label={page.tabs.label}
      className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto @max-lg:basis-full"
    >
      {items.map((i) => {
        const isActive = i.profile === profile;
        return (
          <button
            key={i.profile}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(i.profile)}
            className={cn(
              "flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              isActive
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
            )}
            data-testid={`${kind}-tab-${i.profile}`}
          >
            <span
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                i.active
                  ? i.driver === "human"
                    ? "bg-primary"
                    : "bg-success"
                  : i.starting
                    ? "animate-pulse bg-warning"
                    : page.tabs.errorDot && i.error
                      ? "bg-destructive"
                      : "bg-muted-foreground/40",
              )}
              aria-hidden
            />
            <span className="font-medium">{i.label}</span>
            <span className="text-xs text-muted-foreground">{usersOf(i, page.tabs.own)}</span>
            {page.takeover && i.takeover && (
              <Hand className="size-3.5 text-primary" aria-label="Needs you" />
            )}
          </button>
        );
      })}
    </div>
  );
}
