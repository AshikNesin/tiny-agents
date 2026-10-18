import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Plus, Search } from "lucide-react";
import { Button } from "@groot/ui/button";
import { Input } from "@groot/ui/input";
import { Badge } from "@groot/ui/badge";
import { cn } from "@groot/shell/lib/utils";
import { formatRelativeTime } from "@groot/shell/lib/date.utils";
import type { BotListEntry } from "../lib/bots-api";
import { BotAvatar } from "./BotAvatar";

interface BotListProps {
  bots: BotListEntry[];
  onNewBot: () => void;
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
      <div className="flex items-center gap-2 border-b p-3">
        <div className="relative flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search bots"
            className="h-8 pl-8"
          />
        </div>
        <Button size="sm" onClick={onNewBot}>
          <Plus className="size-4" />
          New bot
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {filtered.map((bot) => (
          <button
            key={bot.id}
            type="button"
            onClick={() => navigate(`/chats/${bot.id}`)}
            className={cn(
              "flex w-full items-center gap-3 border-b px-3 py-2.5 text-left hover:bg-muted/50",
              botId === bot.id && "bg-muted",
            )}
          >
            <BotAvatar name={bot.name} emoji={bot.avatarEmoji} color={bot.avatarColor} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium">{bot.name}</span>
                {bot.unread && !bot.replying && bot.approvals === 0 && (
                  <Badge className="size-1.5 rounded-full bg-primary p-0" aria-label="Unread" />
                )}
              </div>
              <div className="text-muted-foreground truncate text-xs">
                {bot.approvals > 0 ? (
                  <span className="text-primary">needs your approval</span>
                ) : bot.replying ? (
                  <span className="text-primary">typing…</span>
                ) : (
                  (bot.lastMessagePreview ?? bot.description ?? "No messages yet")
                )}
              </div>
            </div>
            <span className="text-muted-foreground shrink-0 text-[11px] whitespace-nowrap">
              {formatRelativeTime(bot.lastActivityAt)}
            </span>
          </button>
        ))}
        {filtered.length === 0 && (
          <p className="text-muted-foreground px-3 py-8 text-center text-sm">
            {query ? "No bots match." : "No bots yet."}
          </p>
        )}
      </div>
    </div>
  );
}
