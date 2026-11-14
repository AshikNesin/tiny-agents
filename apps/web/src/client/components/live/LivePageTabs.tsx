/**
 * The strip over the page's view: a tab per browser or desktop (its dot,
 * label, users and a hand when a bot asked for the owner), and the browser's
 * status line (the connection and who drives).
 */
import { Hand } from "lucide-react";
import { cn } from "@groot/ui/lib/utils";
import type { Connection, LiveViewKind } from "../../lib/live-view";
import type { LivePageSurface, PageItem } from "./surface";

/** Who uses one, for its tab: "3 bots", "Scout", "no bots yet". */
function usersOf(item: PageItem, own: string): string {
  if (item.profile !== "shared") return own;
  const count = item.bots.length;
  return count === 0 ? "no bots yet" : count === 1 ? item.bots[0]!.name : `${count} bots`;
}

/** Who drives a live one, for the status line. */
function driverOf(item: PageItem): string {
  if (item.driver === "human") return "You drive";
  if (item.profile !== "shared") return `${item.label} drives`;
  return item.bots.length === 1 ? `${item.bots[0]!.name} drives` : "Bots drive";
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
  /** The selected tab's profile. */
  profile: string | undefined;
  onSelect: (profile: string) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label={page.tabs.label}
      className="flex shrink-0 items-stretch gap-0.5 overflow-x-auto border-b border-border bg-muted/40 px-1 pt-1"
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
              "flex shrink-0 items-center gap-1.5 rounded-t-lg px-2.5 py-1.5 text-sm",
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
            <span className="text-xs opacity-60">{usersOf(i, page.tabs.own)}</span>
            {page.takeover && i.takeover && (
              <Hand className="size-3.5 text-primary" aria-label="Needs you" />
            )}
          </button>
        );
      })}
    </div>
  );
}

/** The connection and who drives, over the view (the browser's). */
export function LivePageStatusLine({
  kind,
  connection,
  item,
}: {
  kind: LiveViewKind;
  connection: Connection;
  item: PageItem;
}) {
  return (
    <div
      className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5 text-xs text-muted-foreground"
      data-testid={`${kind}-page-status`}
    >
      <span className={cn("size-1.5 shrink-0 rounded-full", connection.dot)} aria-hidden />
      <span>{connection.label}</span>
      <span aria-hidden>·</span>
      <span>{driverOf(item)}</span>
    </div>
  );
}
