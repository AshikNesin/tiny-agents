/**
 * A thread's Review page (`/code/<id>/review`): what the side panes show
 * beside the thread, at full width. **Changes** (Review against the base
 * branch for a project thread, else the harness's own changes) and, for a
 * project thread, **Pull request**, each a tab (`?tab=pr`). Line comments
 * work as in the panes and wait in the tray at the bottom (Send now), or go
 * with the next message back in the thread.
 */
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, FileDiff, GitPullRequest } from "lucide-react";
import { Button } from "@groot/ui";
import { cn } from "@groot/ui/lib/utils";
import { threadPath } from "../../lib/code/api";
import { useIsGuest } from "../../store/people";
import { PendingComments } from "./PendingComments";
import { pullState } from "./controls";

export type ReviewTab = "changes" | "pr";

export function ReviewPage({
  threadId,
  title,
  pr,
  tab,
  onTab,
  changes,
  pull,
  sidebarHidden = false,
}: {
  threadId: string;
  title: string;
  pr: { number: number; loop: string } | null;
  tab: ReviewTab;
  onTab(tab: ReviewTab): void;
  /** The Changes tab's panel (null: the harness serves no diffs). */
  changes: ReactNode;
  /** The Pull request tab's panel (null: not a project thread). */
  pull: ReactNode;
  /** The thread list is folded away: leave room for Show sidebar. */
  sidebarHidden?: boolean;
}) {
  const guest = useIsGuest();
  const state = pr ? pullState(pr.loop) : null;
  const tabs: Array<{ id: ReviewTab; label: string; icon: typeof FileDiff; hint?: string }> = [];
  if (changes) tabs.push({ id: "changes", label: "Changes", icon: FileDiff });
  if (pull)
    tabs.push({
      id: "pr",
      label: pr ? `Pull request #${pr.number}` : "Pull request",
      icon: GitPullRequest,
      hint: state ?? undefined,
    });
  const shown = tabs.some((t) => t.id === tab) ? tab : (tabs[0]?.id ?? "changes");
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="code-review-page">
      <header
        className={cn(
          "border-border flex h-13 shrink-0 items-center gap-1 border-b px-2 sm:px-3",
          sidebarHidden && "md:pl-12",
        )}
      >
        <Button asChild variant="ghost" size="icon-sm" className="shrink-0">
          <Link
            to={threadPath(threadId)}
            aria-label="Back to the thread"
            title="Back to the thread"
          >
            <ArrowLeft />
          </Link>
        </Button>
        <h1 className="min-w-0 truncate px-1 text-sm font-medium">{title}</h1>
        <div role="tablist" aria-label="Review" className="ml-2 flex shrink-0 items-center gap-0.5">
          {tabs.map(({ id, label, icon: Icon, hint }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={shown === id}
              aria-label={label}
              onClick={() => onTab(id)}
              className={cn(
                "flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                shown === id
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-4" aria-hidden />
              <span className="hidden sm:inline">{label}</span>
              {hint && (
                <span className="text-muted-foreground hidden text-xs md:inline">· {hint}</span>
              )}
            </button>
          ))}
        </div>
      </header>
      <div
        role="tabpanel"
        aria-label={tabs.find((t) => t.id === shown)?.label}
        className="min-h-0 flex-1"
      >
        {shown === "pr" ? pull : changes}
      </div>
      <div className="mx-auto w-full max-w-3xl px-3 empty:hidden sm:px-5 [&:has(section)]:py-2">
        <PendingComments threadId={threadId} enabled={!guest} />
      </div>
    </div>
  );
}
