import { Checkbox } from "@groot/ui/checkbox";
import { Section } from "@groot/shell/components/layout/Section";
import type { BotListEntry } from "../../../../shared/api/bots";
import type { Skill } from "../../../../shared/api/skills";
import { EveryBotSwitch } from "../../../components/EveryBotSwitch";

export function SkillBotsSection({
  skill,
  bots,
  usedBy,
  toggleBot,
  setAllBots,
}: {
  skill: Skill;
  bots: BotListEntry[] | null;
  usedBy: number;
  toggleBot: (botId: string) => Promise<void>;
  setAllBots: (allBots: boolean) => Promise<void>;
}) {
  return (
    <Section title="Used by bots" meta={bots ? `${usedBy} of ${bots.length}` : undefined}>
      <div className="mb-3">
        <EveryBotSwitch checked={skill.allBots} onCheckedChange={(on) => void setAllBots(on)} />
      </div>
      {bots === null ? (
        <p className="text-muted-foreground py-4 text-center text-sm">Loading…</p>
      ) : bots.length === 0 ? (
        <p className="text-muted-foreground py-4 text-center text-sm">
          No bots yet. Create a bot to assign this skill to it.
        </p>
      ) : (
        <div className="space-y-2">
          {usedBy === 0 && (
            <p className="text-muted-foreground text-sm">
              No bot loads this skill yet. Tick the bots that should have it.
            </p>
          )}
          {bots.map((bot) => {
            const enabled = skill.botIds.includes(bot.id);
            return (
              <div key={bot.id} className="flex items-start gap-3 rounded-lg border p-3">
                <Checkbox
                  id={`skill-bot-${skill.id}-${bot.id}`}
                  className="mt-0.5"
                  checked={enabled}
                  onCheckedChange={() => void toggleBot(bot.id)}
                  aria-label={`Use ${skill.name} with ${bot.name}`}
                />
                <label
                  htmlFor={`skill-bot-${skill.id}-${bot.id}`}
                  className="min-w-0 flex-1 cursor-pointer"
                >
                  <span className="block truncate text-sm font-medium">{bot.name}</span>
                  <span className="text-muted-foreground mt-0.5 line-clamp-1 block text-xs">
                    {bot.description}
                  </span>
                </label>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}
