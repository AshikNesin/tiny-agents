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
  DialogBody,
} from "@groot/ui/dialog";
import { Button } from "@groot/ui/button";
import { Input } from "@groot/ui/input";
import { Textarea } from "@groot/ui/textarea";
import { Label } from "@groot/ui/label";
import type { Skill } from "../../../shared/api/skills";
import { useSkillMutations } from "../../queries/skills";
import { errorMessage } from "../../lib/errors";

const NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const EMPTY_FORM = { name: "", description: "", body: "" };

/** Why the name is rejected, or null when it's valid (server's SKILL_NAME). */
function nameProblem(name: string): string | null {
  if (name.length === 0) return "Name is required.";
  if (name.length > 64) return "Keep it to 64 characters or fewer.";
  if (!NAME_PATTERN.test(name))
    return "Lowercase letters, digits and single hyphens (no leading/trailing hyphen).";
  return null;
}

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
  const { create: createSkill } = useSkillMutations();
  /** Fields the user has interacted with — errors show only after that. */
  const [touched, setTouched] = useState({ name: false, description: false });

  useEffect(() => {
    if (open) {
      setForm(EMPTY_FORM);
      setTouched({ name: false, description: false });
    }
  }, [open]);

  const name = form.name.trim();
  const nameError = nameProblem(name);
  const descriptionError = form.description.trim().length > 0 ? null : "Description is required.";
  const valid = nameError === null && descriptionError === null;
  const showNameError = touched.name && nameError !== null;
  const showDescriptionError = touched.description && descriptionError !== null;

  const create = async () => {
    // A click on a disabled button can't reach here, but a stray Enter in a
    // text field could: surface the problems instead of silently doing nothing.
    setTouched({ name: true, description: true });
    if (!valid) {
      toast.error("Fill in the required fields to create the skill.");
      return;
    }
    setSaving(true);
    try {
      const skill = await createSkill.mutateAsync({
        name,
        description: form.description.trim(),
        body: form.body,
      });
      toast.success("Skill created");
      onOpenChange(false);
      onCreated(skill);
    } catch (error) {
      toast.error(errorMessage(error, "Failed to create skill"));
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
        <DialogBody>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-skill-name">Name</Label>
              <Input
                id="new-skill-name"
                value={form.name}
                maxLength={64}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                onBlur={() => setTouched((prev) => ({ ...prev, name: true }))}
                placeholder="pdf-form-filler"
                aria-invalid={showNameError}
                aria-describedby={showNameError ? "new-skill-name-error" : undefined}
              />
              {showNameError ? (
                <p id="new-skill-name-error" className="text-xs text-destructive">
                  {nameError}
                </p>
              ) : (
                <p className="text-muted-foreground text-xs">
                  Lowercase letters, digits and hyphens. Bots reference the skill by this name.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-skill-description">Description</Label>
              <Textarea
                id="new-skill-description"
                rows={3}
                maxLength={1024}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                onBlur={() => setTouched((prev) => ({ ...prev, description: true }))}
                placeholder="What the skill does and when the bot should load it"
                aria-invalid={showDescriptionError}
                aria-describedby={showDescriptionError ? "new-skill-description-error" : undefined}
              />
              {showDescriptionError && (
                <p id="new-skill-description-error" className="text-xs text-destructive">
                  {descriptionError}
                </p>
              )}
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
        </DialogBody>

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
