import { useMemo } from "react";
import { Link } from "react-router-dom";
import { cn } from "@groot/ui/lib/utils";
import { threadPath } from "../../lib/code/api";
import { activeThreads, groupOf, STATUS_DOT, starterOf } from "../../lib/code/list";
import { useCodeStore } from "../../store/code";

const SHOWN = 5;

export function ThreadsSection({ onNavigate = () => {} }: { onNavigate?: () => void }) {
  const threads = useCodeStore((s) => s.threads);
  const { shown, more } = useMemo(() => activeThreads(threads ?? [], SHOWN), [threads]);
  if (threads === null) return null;
  return (
    <section aria-label="Threads" className="px-2.5 pb-2">
      <div className="flex h-8 items-center justify-between px-1.5">
        <h2 className="text-fg-tertiary text-sm font-medium select-none">Threads</h2>
        <Link
          to="/code"
          onClick={onNavigate}
          className="text-muted-foreground hover:text-foreground rounded-lg px-1.5 text-xs outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring"
        >
          {more > 0 ? `All threads, ${more} more` : "All threads"}
        </Link>
      </div>
      {shown.length === 0 ? (
        <p className="text-fg-tertiary px-1.5 pb-1 text-xs">Nothing running or waiting on you.</p>
      ) : (
        <ul className="space-y-0.5">
          {shown.map((row) => {
            const starter = starterOf(row);
            const status = groupOf(row);
            return (
              <li key={row.id}>
                <Link
                  to={threadPath(row.id)}
                  onClick={onNavigate}
                  data-thread={row.id}
                  data-status={status}
                  className="hover:bg-sidebar-accent flex h-8 items-center gap-2 rounded-xl px-1.5 text-sm outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring"
                >
                  <span className="grid size-6 shrink-0 place-items-center" aria-hidden>
                    <span className={cn("size-1.5 rounded-full", STATUS_DOT[status])} />
                  </span>
                  <span className={cn("min-w-0 flex-1 truncate", row.unread && "font-medium")}>
                    {row.title || "Untitled"}
                  </span>
                  {(row.status?.reason === "asks you" || starter) && (
                    <span className="text-muted-foreground max-w-24 shrink-0 truncate text-xs">
                      {row.status?.reason === "asks you" ? "asks you" : starter}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
