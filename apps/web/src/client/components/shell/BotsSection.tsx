import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { History, MoreHorizontal, Pencil, Pin, PinOff, Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@groot/ui/dropdown-menu";
import { cn } from "@groot/ui/lib/utils";
import type { BotListEntry } from "../../../shared/api/bots";
import { groupBots, previewLine, relativeTime, visibleRecent } from "../../lib/bot-groups";
import { attentionOf, railBots, stateLabel, waitingLabel } from "../../lib/attention";
import { useBotsStore } from "../../store/bots";
import { useViewerRole } from "../../store/people";
import { useUiStore } from "../../store/ui";
import { BotAvatar } from "../BotAvatar";

function RowStatus({ bot, active }: { bot: BotListEntry; active: boolean }) {
  const { waiting, replying, unread } = attentionOf(bot);
  if (waiting > 0) {
    return (
      <span
        aria-label={waitingLabel(bot)}
        className="bg-primary text-primary-foreground flex min-w-5 items-center justify-center rounded-full px-1.5 text-xs"
      >
        {waiting}
      </span>
    );
  }
  if (replying) {
    return (
      <span role="status" aria-label="Replying" className="flex items-center gap-0.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="bg-fg-tertiary size-1 animate-pulse rounded-full"
            style={{ animationDelay: `${i * 150}ms` }}
          />
        ))}
      </span>
    );
  }
  if (unread && !active) {
    return <span aria-label="Unread" className="bg-primary block size-2 shrink-0 rounded-full" />;
  }
  return null;
}

function BotRow({
  bot,
  active,
  onNavigate,
}: {
  bot: BotListEntry;
  active: boolean;
  onNavigate: () => void;
}) {
  const togglePin = useBotsStore((s) => s.togglePin);
  const openEditBot = useUiStore((s) => s.openEditBot);
  const navigate = useNavigate();
  const owner = useViewerRole() === "owner";
  const pinned = bot.pinnedAt !== null;
  const preview = bot.lastMessagePreview ? previewLine(bot.lastMessagePreview) : "";
  const previewId = `bot-preview-${bot.id}`;

  return (
    <li className="group/row relative">
      <Link
        to={`/chats/${bot.id}`}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        aria-label={stateLabel(bot)}
        aria-describedby={preview ? previewId : undefined}
        className={cn(
          "flex min-h-9 items-center gap-2 rounded-xl py-1.5 pr-2 pl-1.5 text-sm outline-none",
          "focus-visible:ring-sidebar-ring focus-visible:ring-1",
          active ? "bg-sidebar-accent" : "hover:bg-sidebar-accent",
        )}
      >
        <BotAvatar name={bot.name} className="size-6" />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate">{bot.name}</span>
            {preview && (
              <span className="text-muted-foreground shrink-0 text-[11px] group-focus-within/row:invisible group-hover/row:invisible group-has-[[data-state=open]]/row:invisible">
                {relativeTime(bot.lastActivityAt)}
              </span>
            )}
          </span>
          {preview && (
            <span id={previewId} className="text-muted-foreground block truncate text-xs">
              {preview}
            </span>
          )}
        </span>
        <span className="group-focus-within/row:hidden group-hover/row:hidden group-has-[[data-state=open]]/row:hidden">
          <RowStatus bot={bot} active={active} />
        </span>
      </Link>
      {owner && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`${bot.name} actions`}
              className="text-muted-foreground hover:bg-sidebar-accent focus-visible:ring-sidebar-ring absolute top-1.5 right-1.5 flex size-6 items-center justify-center rounded-lg opacity-0 outline-none group-focus-within/row:opacity-100 group-hover/row:opacity-100 focus-visible:ring-1 data-[state=open]:opacity-100"
            >
              <MoreHorizontal className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="right">
            <DropdownMenuItem onSelect={() => void togglePin(bot.id)}>
              {pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
              {pinned ? "Unpin" : "Pin"}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void openEditBot(bot.id)}>
              <Pencil className="size-4" /> Edit bot
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                onNavigate();
                navigate(`/chats/${bot.id}?history=1`);
              }}
            >
              <History className="size-4" /> Chat history
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  );
}

function GroupLabel({ children }: { children: string }) {
  return <p className="text-fg-tertiary px-1.5 pt-2 pb-1 text-xs select-none">{children}</p>;
}

interface BotsSectionProps {
  bots: BotListEntry[];
  activeId: string | null;
  onNavigate?: () => void;
}

export function BotsSection({ bots, activeId, onNavigate = () => {} }: BotsSectionProps) {
  const openCreateBot = useUiStore((s) => s.openCreateBot);
  const role = useViewerRole();
  const [expanded, setExpanded] = useState(false);
  const { needsYou, working, pinned, recent } = useMemo(() => groupBots(bots), [bots]);
  const above = needsYou.length + working.length + pinned.length;
  const shown = visibleRecent(recent, expanded, activeId);
  const hidden = recent.length - shown.length;
  const foldable = recent.length > shown.length || (expanded && recent.length > 8);

  return (
    <section aria-label="Bots" className="px-2.5">
      <div className="flex h-8 items-center justify-between px-1.5">
        <h2 className="text-fg-tertiary text-sm font-medium select-none">Bots</h2>
        {role === "owner" && (
          <button
            type="button"
            onClick={openCreateBot}
            aria-label="New bot"
            className="text-muted-foreground hover:bg-sidebar-accent hover:text-foreground flex size-6 items-center justify-center rounded-lg"
          >
            <Plus className="size-4" />
          </button>
        )}
      </div>

      {bots.length === 0 && (
        <p className="text-fg-tertiary px-1.5 py-2 text-sm">
          {role === "guest" ? "Nothing shared with you yet." : "No bots yet."}
        </p>
      )}

      {needsYou.length > 0 && (
        <>
          <GroupLabel>Needs you</GroupLabel>
          <ul className="space-y-0.5" aria-label="Needs you">
            {needsYou.map((bot) => (
              <BotRow key={bot.id} bot={bot} active={bot.id === activeId} onNavigate={onNavigate} />
            ))}
          </ul>
        </>
      )}

      {working.length > 0 && (
        <>
          <GroupLabel>Working</GroupLabel>
          <ul className="space-y-0.5" aria-label="Working">
            {working.map((bot) => (
              <BotRow key={bot.id} bot={bot} active={bot.id === activeId} onNavigate={onNavigate} />
            ))}
          </ul>
        </>
      )}

      {pinned.length > 0 && (
        <>
          <GroupLabel>Pinned</GroupLabel>
          <ul className="space-y-0.5">
            {pinned.map((bot) => (
              <BotRow key={bot.id} bot={bot} active={bot.id === activeId} onNavigate={onNavigate} />
            ))}
          </ul>
        </>
      )}

      {recent.length > 0 && (
        <>
          {above > 0 && <GroupLabel>Recent</GroupLabel>}
          <ul className="space-y-0.5">
            {shown.map((bot) => (
              <BotRow key={bot.id} bot={bot} active={bot.id === activeId} onNavigate={onNavigate} />
            ))}
          </ul>
          {foldable && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="text-muted-foreground hover:text-foreground mt-0.5 flex h-9 w-full items-center rounded-xl px-1.5 text-sm font-medium"
            >
              {expanded ? "Show less" : `Show more${hidden > 0 ? ` (${hidden})` : ""}`}
            </button>
          )}
        </>
      )}
    </section>
  );
}

export function BotRail({ bots, activeId }: { bots: BotListEntry[]; activeId: string | null }) {
  const setCollapsed = useUiStore((s) => s.setCollapsed);
  const { shown, hiddenWaiting } = useMemo(() => railBots(bots, activeId), [bots, activeId]);
  return (
    <nav aria-label="Bots" className="flex flex-col items-center gap-1.5 py-2">
      {shown.map((bot) => {
        const { waiting, replying, unread } = attentionOf(bot);
        const label = stateLabel(bot);
        return (
          <Link
            key={bot.id}
            to={`/chats/${bot.id}`}
            aria-label={label}
            title={label}
            aria-current={bot.id === activeId ? "page" : undefined}
            className={cn(
              "relative flex size-9 items-center justify-center rounded-xl outline-none",
              "focus-visible:ring-sidebar-ring focus-visible:ring-1",
              bot.id === activeId ? "bg-sidebar-accent" : "hover:bg-sidebar-accent",
            )}
          >
            <BotAvatar name={bot.name} className="size-6" />
            {waiting > 0 ? (
              <span className="bg-primary text-primary-foreground absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-4">
                {waiting}
              </span>
            ) : replying ? (
              <span className="bg-fg-tertiary absolute top-0.5 right-0.5 block size-2 animate-pulse rounded-full" />
            ) : unread && bot.id !== activeId ? (
              <span className="bg-primary absolute top-0.5 right-0.5 block size-2 rounded-full" />
            ) : null}
          </Link>
        );
      })}
      {hiddenWaiting > 0 && (
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          aria-label={`${hiddenWaiting} more waiting on you: expand the sidebar`}
          title="More bots are waiting on you"
          className="bg-primary text-primary-foreground rounded-full px-1.5 text-[10px] leading-4"
        >
          +{hiddenWaiting}
        </button>
      )}
    </nav>
  );
}
