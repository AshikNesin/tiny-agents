import { Bot } from "lucide-react";
import { Card } from "@groot/ui/card";
import { Checkbox } from "@groot/ui/checkbox";
import { EmptyState } from "@groot/ui/empty-state";
import { listRowClass } from "@groot/ui/list-row";
import { Section } from "@groot/shell/components/layout/Section";
import type { BotListEntry } from "../../../../shared/api/bots";
import type { Connection } from "../../../../shared/api/connections";
import { BotAvatar } from "../../../components/BotAvatar";

export function ConnectionBotsSection({
  connection,
  bots,
  onToggleBot,
}: {
  connection: Connection;
  bots: BotListEntry[] | null;
  onToggleBot: (botId: string, enable: boolean) => void;
}) {
  return (
    <Section
      title="Used by bots"
      meta={connection.botIds.length === 1 ? "1 bot" : `${connection.botIds.length} bots`}
    >
      {bots === null ? (
        <p className="py-4 text-center text-sm text-muted-foreground">Loading…</p>
      ) : bots.length === 0 ? (
        <EmptyState icon={Bot} title="No bots yet" description="Create a bot to use these tools." />
      ) : (
        <Card className="divide-y overflow-hidden p-0">
          <ul role="list">
            {bots.map((bot) => (
              <li key={bot.id} className={listRowClass}>
                <Checkbox
                  id={`connection-bot-${bot.id}`}
                  checked={connection.botIds.includes(bot.id)}
                  onCheckedChange={(checked) => onToggleBot(bot.id, checked === true)}
                  aria-label={`Use ${connection.name} tools in ${bot.name}`}
                />
                <label
                  htmlFor={`connection-bot-${bot.id}`}
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-3"
                >
                  <BotAvatar name={bot.name} className="size-8 text-xs" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {bot.name}
                    </span>
                    {bot.description && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {bot.description}
                      </span>
                    )}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </Section>
  );
}
