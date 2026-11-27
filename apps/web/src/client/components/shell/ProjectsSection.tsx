import { useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { cn } from "@groot/ui/lib/utils";
import type { BotListEntry } from "../../../shared/api/bots";
import { relativeTime } from "../../lib/bot-groups";
import { attentionOf } from "../../lib/attention";
import { projectChatPath } from "../../lib/code/api";
import { BotAvatar } from "../BotAvatar";
import { MoreRow, SidebarSection } from "./SidebarSection";

const SHOWN = 3;

export function ProjectsSection({
  bots,
  onNavigate = () => {},
}: {
  bots: readonly BotListEntry[];
  onNavigate?: () => void;
}) {
  const { pathname } = useLocation();
  const projects = useMemo(
    () =>
      bots
        .filter((bot): bot is BotListEntry & { projectId: string } => bot.projectId !== null)
        .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt)),
    [bots],
  );
  const [expanded, setExpanded] = useState(false);
  if (projects.length === 0) return null;
  const head = projects.slice(0, SHOWN);
  const active = projects.find(
    (bot) => pathname === `/chats/${bot.id}` || pathname === projectChatPath(bot.projectId),
  );
  const shown =
    expanded || projects.length <= SHOWN
      ? projects
      : active && !head.includes(active)
        ? [...head, active]
        : head;
  return (
    <SidebarSection title="Projects">
      <ul className="space-y-0.5">
        {shown.map((bot) => {
          const to = `/chats/${bot.id}`;
          const active = pathname === to || pathname === projectChatPath(bot.projectId);
          const { waiting, unread } = attentionOf(bot);
          return (
            <li key={bot.id}>
              <Link
                to={to}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                data-project={bot.projectId}
                className={cn(
                  "focus-visible:ring-sidebar-ring flex h-9 items-center gap-2.5 rounded-xl px-1.5 text-sm outline-none focus-visible:ring-1",
                  active ? "bg-sidebar-accent" : "hover:bg-sidebar-accent",
                )}
              >
                <BotAvatar name={bot.name} className="size-6" />
                <span className={cn("min-w-0 flex-1 truncate", unread && "font-medium")}>
                  {bot.name}
                </span>
                {waiting > 0 ? (
                  <span className="bg-primary text-primary-foreground flex min-w-5 items-center justify-center rounded-full px-1.5 text-xs">
                    {waiting}
                  </span>
                ) : (
                  bot.lastMessagePreview && (
                    <span className="text-muted-foreground shrink-0 text-xs">
                      {relativeTime(bot.lastActivityAt)}
                    </span>
                  )
                )}
              </Link>
            </li>
          );
        })}
      </ul>
      {projects.length > SHOWN && (
        <MoreRow
          hidden={projects.length - shown.length}
          expanded={expanded}
          onToggle={() => setExpanded((v) => !v)}
        />
      )}
    </SidebarSection>
  );
}
