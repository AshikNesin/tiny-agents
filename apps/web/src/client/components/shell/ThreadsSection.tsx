import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { cn } from "@groot/ui/lib/utils";
import { threadPath } from "../../lib/code/api";
import { activeThreads, groupOf, STATUS_DOT, starterOf } from "../../lib/code/list";
import { relativeTime } from "../../lib/bot-groups";
import { useCodeStore } from "../../store/code";
import { BotAvatar } from "../BotAvatar";
import { MoreRow, SidebarSection } from "./SidebarSection";

const SHOWN = 5;

export function ThreadsSection({ onNavigate = () => {} }: { onNavigate?: () => void }) {
  const threads = useCodeStore((s) => s.threads);
  const [expanded, setExpanded] = useState(false);
  const { shown, more } = useMemo(
    () => activeThreads(threads ?? [], expanded ? Number.MAX_SAFE_INTEGER : SHOWN),
    [threads, expanded],
  );
  if (threads === null) return null;
  return (
    <SidebarSection
      title="Threads"
      action={
        <Link
          to="/code"
          onClick={onNavigate}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-sidebar-ring rounded-lg px-1.5 text-xs outline-none focus-visible:ring-1"
        >
          All threads
        </Link>
      }
    >
      {shown.length === 0 ? (
        <p className="text-fg-tertiary px-1.5 pb-1 text-xs">Nothing running or waiting on you.</p>
      ) : (
        <ul className="space-y-0.5">
          {shown.map((row) => {
            const starter = starterOf(row);
            const status = groupOf(row);
            const asks = row.status?.reason === "asks you";
            return (
              <li key={row.id}>
                <Link
                  to={threadPath(row.id)}
                  onClick={onNavigate}
                  data-thread={row.id}
                  data-status={status}
                  title={starter ? `Started by ${starter}` : undefined}
                  className="hover:bg-sidebar-accent focus-visible:ring-sidebar-ring flex h-9 items-center gap-2.5 rounded-xl px-1.5 text-sm outline-none focus-visible:ring-1"
                >
                  <span className="relative grid size-6 shrink-0 place-items-center" aria-hidden>
                    {starter ? (
                      <BotAvatar name={row.startedBy?.name ?? starter} className="size-6" />
                    ) : (
                      <span className="bg-sidebar-accent size-6 rounded-lg" />
                    )}
                    <span
                      className={cn(
                        "ring-sidebar absolute size-2 rounded-full ring-2",
                        starter ? "-right-0.5 -bottom-0.5" : "",
                        STATUS_DOT[status],
                      )}
                    />
                  </span>
                  <span className={cn("min-w-0 flex-1 truncate", row.unread && "font-medium")}>
                    {row.title || "Untitled"}
                  </span>
                  {starter && <span className="sr-only">, started by {starter}</span>}
                  <span
                    className={cn(
                      "shrink-0 text-xs",
                      asks ? "text-foreground font-medium" : "text-muted-foreground",
                    )}
                  >
                    {asks ? "asks you" : relativeTime(row.updatedAt)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {(more > 0 || expanded) && (
        <MoreRow hidden={more} expanded={expanded} onToggle={() => setExpanded((v) => !v)} />
      )}
    </SidebarSection>
  );
}
