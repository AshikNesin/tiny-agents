/**
 * The thread's right panel: one strip of tabs over what it shows. Source
 * control (the changed files and their diffs) and, for a project thread,
 * Pull request (checks with their logs, comments, merge). Open as a page
 * and Close sit at the strip's end, so the panels below carry no chrome
 * of their own.
 */
import type { ReactNode } from "react";
import { GitBranch, GitPullRequest, Maximize2, X } from "lucide-react";
import { Button } from "@groot/ui";
import { cn } from "@groot/ui/lib/utils";
import { pullState } from "./controls";

export type SideTab = "source" | "pr";

export function ReviewSidebar({
  tab,
  onTab,
  pr,
  hasPull,
  onExpand,
  onClose,
  children,
}: {
  tab: SideTab;
  onTab(tab: SideTab): void;
  /** The thread's open pull request, for the tab's label. */
  pr: { number: number; loop: string } | null;
  /** A project thread: it has a Pull request tab. */
  hasPull: boolean;
  onExpand(): void;
  onClose(): void;
  children: ReactNode;
}) {
  const state = pr ? pullState(pr.loop) : null;
  const tabs: Array<{ id: SideTab; label: string; icon: typeof GitBranch; hint?: string | null }> =
    [{ id: "source", label: "Source control", icon: GitBranch }];
  if (hasPull)
    tabs.push({
      id: "pr",
      label: pr ? `Pull request #${pr.number}` : "Pull request",
      icon: GitPullRequest,
      hint: state,
    });
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="code-side-panel">
      <div className="border-border flex h-13 shrink-0 items-center gap-1 border-b px-2">
        <div role="tablist" aria-label="Review panel" className="flex min-w-0 items-center gap-0.5">
          {tabs.map(({ id, label, icon: Icon, hint }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              aria-label={label}
              title={label}
              onClick={() => onTab(id)}
              className={cn(
                "flex h-8 min-w-0 items-center gap-1.5 rounded-lg px-2.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                tab === id
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              <span className="truncate">{label}</span>
              {hint && (
                <span
                  className={cn(
                    "hidden shrink-0 text-xs xl:inline",
                    pr?.loop === "needs_input" ? "text-warning" : "text-muted-foreground",
                  )}
                >
                  · {hint}
                </span>
              )}
            </button>
          ))}
        </div>
        <span className="flex-1" />
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onExpand}
          aria-label="Open as a page"
          title="Open as a page"
          className="text-muted-foreground"
        >
          <Maximize2 />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          aria-label="Close panel"
          title="Close (⌘⇧D)"
          className="text-muted-foreground"
        >
          <X />
        </Button>
      </div>
      <div
        role="tabpanel"
        aria-label={tabs.find((t) => t.id === tab)?.label}
        className="min-h-0 flex-1"
      >
        {children}
      </div>
    </div>
  );
}
