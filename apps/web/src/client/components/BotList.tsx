import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { LogOut, Plug, Plus, Search, ListTodo, Settings, Sparkles } from "lucide-react";
import { Button } from "@groot/ui/button";
import { Input } from "@groot/ui/input";
import { Badge } from "@groot/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@groot/ui/dropdown-menu";
import { useAuthStore } from "@groot/shell/store/auth";
import { cn } from "@groot/shell/lib/utils";
import { formatRelativeTime } from "@groot/shell/lib/date.utils";
import type { BotListEntry } from "../lib/bots-api";
import { BotAvatar } from "./BotAvatar";

interface BotListProps {
  bots: BotListEntry[];
  onNewBot: () => void;
}

/** Grok-style profile circle: initials on a ring, opening the app nav +
 *  account menu. This replaces the shell sidebar on the chats workspace. */
function ProfileButton() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const initial = (user?.name?.[0] ?? user?.email?.[0] ?? "?").toUpperCase();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Account and navigation"
          className="border-input text-muted-foreground hover:text-foreground flex size-10 shrink-0 items-center justify-center rounded-full border text-sm font-semibold transition-transform active:scale-95"
        >
          {initial}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuItem onSelect={() => navigate("/tasks")}>
          <ListTodo className="size-4" /> Tasks
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate("/skills")}>
          <Sparkles className="size-4" /> Skills
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate("/connections")}>
          <Plug className="size-4" /> Connections
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate("/settings")}>
          <Settings className="size-4" /> Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onSelect={() => {
            void logout();
            navigate("/login");
          }}
        >
          <LogOut className="size-4" /> Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Column 2 (PRD §6.2): searchable, activity-sorted bot rows. */
export function BotList({ bots, onNewBot }: BotListProps) {
  const { botId } = useParams();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return bots;
    return bots.filter(
      (bot) => bot.name.toLowerCase().includes(q) || bot.description.toLowerCase().includes(q),
    );
  }, [bots, query]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Grok-style controls: profile circle left, pill search and a
          circular add button right. One calm row of chrome, no sidebar. */}
      <div className="flex items-center gap-2 px-3 pt-4 pb-3">
        <ProfileButton />
        <div className="relative min-w-0 flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            aria-label="Search bots"
            className="h-10 rounded-full pl-9"
          />
        </div>
        <Button
          variant="outline"
          size="icon"
          onClick={onNewBot}
          aria-label="New bot"
          className="size-10 shrink-0 rounded-full"
        >
          <Plus className="size-5" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-4">
        {filtered.map((bot) => {
          const active = botId === bot.id;
          return (
            <button
              key={bot.id}
              type="button"
              onClick={() => navigate(`/chats/${bot.id}`)}
              className={cn(
                "flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left",
                active ? "bg-muted" : "hover:bg-muted/50",
              )}
            >
              <BotAvatar name={bot.name} className="size-11" />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[15px] font-semibold">{bot.name}</span>
                  <span className="text-muted-foreground shrink-0 text-xs whitespace-nowrap">
                    {formatListTime(bot.lastActivityAt)}
                  </span>
                </div>
                <div className="text-muted-foreground mt-0.5 truncate text-sm">
                  {bot.approvals > 0 ? (
                    <span className="text-primary">needs your approval</span>
                  ) : bot.replying ? (
                    <span className="text-primary">typing…</span>
                  ) : (
                    (bot.lastMessagePreview ?? bot.description ?? "No messages yet")
                  )}
                </div>
              </div>
              {bot.unread && !bot.replying && bot.approvals === 0 && (
                <Badge className="size-2 rounded-full bg-primary p-0" aria-label="Unread" />
              )}
            </button>
          );
        })}
        {filtered.length === 0 && (
          <p className="text-muted-foreground px-3 py-8 text-center text-sm">
            {query ? "No bots match." : "No bots yet."}
          </p>
        )}
      </div>
    </div>
  );
}

/** Messenger-style time: compact relative stamps that age into weekdays. */
function formatListTime(date: string): string {
  const rel = formatRelativeTime(date);
  // dayjs "fromNow" strings start with the count ("3h", "a few seconds
  // ago"); shorten the noisy ones into Grok-style labels.
  if (rel === "a few seconds ago") return "now";
  if (rel === "a minute ago") return "1m";
  if (rel.endsWith(" minutes ago")) return `${parseInt(rel, 10)}m`;
  if (rel === "an hour ago") return "1h";
  if (rel.endsWith(" hours ago")) return `${parseInt(rel, 10)}h`;
  if (rel === "a day ago") return "yesterday";
  if (rel.endsWith(" days ago")) return `${parseInt(rel, 10)}d`;
  return rel;
}
