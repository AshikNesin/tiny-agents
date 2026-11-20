import { Card, CardContent, CardHeader, CardTitle } from "@groot/ui/card";
import { Input } from "@groot/ui/input";
import { Label } from "@groot/ui/label";
import type { Skill } from "../../../../shared/api/skills";

export function SkillDetailsCard({
  skill,
  form,
  setForm,
}: {
  skill: Skill;
  form: { description: string; body: string };
  setForm: (form: { description: string; body: string }) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Details</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="skill-name">Name</Label>
          <Input id="skill-name" value={skill.name} disabled />
          <p className="text-muted-foreground text-xs">
            Bots reference a skill by its name, so it can't be changed.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="skill-description">Description</Label>
          <Input
            id="skill-description"
            value={form.description}
            maxLength={1024}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
          <p className="text-muted-foreground text-xs">
            Shown when the bot decides whether to load this skill.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
