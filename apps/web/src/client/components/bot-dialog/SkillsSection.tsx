import type { SkillSummary } from "../../../shared/api/skills";
import { toggleId, type BotDraft } from "../../lib/bot-draft";
import { Switch } from "../ui/switch";

export function SkillsSection({
  skills,
  draft,
  setDraft,
}: {
  skills: SkillSummary[];
  draft: BotDraft;
  setDraft: (next: (current: BotDraft) => BotDraft) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-muted-foreground text-xs">
        Skills from your library the bot can load when a task needs them.
      </p>
      {skills.length === 0 && (
        <p className="text-muted-foreground py-6 text-center text-sm">
          No skills yet. Create or import one on the Skills page.
        </p>
      )}
      {skills.map((skill) => {
        const enabled = draft.skillIds.includes(skill.id);
        return (
          <div
            key={skill.id}
            className="bg-secondary/50 flex cursor-pointer items-start gap-3 rounded-2xl p-3.5"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{skill.name}</p>
              <p className="text-muted-foreground line-clamp-2 text-xs">{skill.description}</p>
            </div>
            <Switch
              checked={enabled}
              onCheckedChange={(checked) =>
                setDraft((current) => ({
                  ...current,
                  skillIds: toggleId(current.skillIds, skill.id, checked),
                }))
              }
              aria-label={`Assign ${skill.name}`}
            />
          </div>
        );
      })}
    </div>
  );
}
