/** "New skill" dialog (issue #1 M2): name, description, body → POST /skills. */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@groot/ui/dialog";
import { Button } from "@groot/ui/button";
import { Input } from "@groot/ui/input";
import { Textarea } from "@groot/ui/textarea";
import { Label } from "@groot/ui/label";
import { skillsApi, type Skill } from "../../lib/skills-api";

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

const EMPTY_FORM = { name: "", description: "", body: "" };

export function CreateSkillDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (skill: Skill) => void;
}) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setForm(EMPTY_FORM);
  }, [open]);

  const name = form.name.trim();
  const nameValid = NAME_PATTERN.test(name) && name.length <= 64;
  const descriptionValid = form.description.trim().length > 0;
  const valid = nameValid && descriptionValid;

  const create = async () => {
    setSaving(true);
    try {
      const skill = await skillsApi.create({
        name,
        description: form.description.trim(),
        body: form.body,
      });
      toast.success("Skill created");
      onOpenChange(false);
      onCreated(skill);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create skill");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New skill</DialogTitle>
          <DialogDescription>
            A name, a short description, and the instructions your bot follows.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="new-skill-name">Name</Label>
            <Input
              id="new-skill-name"
              value={form.name}
              maxLength={64}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="pdf-form-filler"
              aria-invalid={form.name.length > 0 && !nameValid}
            />
            <p className="text-muted-foreground text-xs">
              Lowercase letters, digits and hyphens — bots reference the skill by this name.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-skill-description">Description</Label>
            <Textarea
              id="new-skill-description"
              rows={3}
              maxLength={1024}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="What the skill does and when the bot should load it"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-skill-body">Instructions</Label>
            <Textarea
              id="new-skill-body"
              rows={8}
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
              placeholder="Write the skill's instructions in markdown…"
              className="font-mono"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void create()} disabled={!valid || saving}>
            Create skill
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
