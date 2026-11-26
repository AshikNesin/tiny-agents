import { useEffect, useMemo, useState } from "react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@groot/ui/select";
import { metaLabelClass } from "@groot/ui/typography";
import { cn } from "@groot/ui/lib/utils";
import type { Routine } from "../../../shared/api/routines";
import { landingBotId } from "../../lib/last-bot";
import { useBotChoices } from "../../queries/bot-choices";
import { useRoutineMutations } from "../../queries/routines";
import {
  MAX_NAME_CHARS,
  MAX_PROMPT_CHARS,
  describeSchedule,
  formatIst,
  previewFireTimes,
  MAX_PROGRESS_CHARS,
} from "../../../shared/routines-schedule";
import { errorMessage } from "../../lib/errors";
import {
  compileSchedule,
  defaultForm,
  formFromRoutine,
  nameFromPrompt,
  type EditorForm,
} from "./routine-form";
import { ScheduleFields } from "./ScheduleFields";

export function RoutineEditor({
  open,
  routine,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  routine: Routine | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void | Promise<void>;
}) {
  const choices = useBotChoices({ enabled: open });
  const bots = choices.data ?? null;
  const { create, update } = useRoutineMutations();
  const [form, setForm] = useState<EditorForm>(() => defaultForm());
  const [saving, setSaving] = useState(false);
  const [loadedId, setLoadedId] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !bots) return;
    const pick = landingBotId(bots);
    if (pick) setForm((current) => (current.botId ? current : { ...current, botId: pick }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bots]);

  useEffect(() => {
    if (!open) return;
    if (routine) {
      if (routine.id === loadedId) return;
      setLoadedId(routine.id);
      setForm(formFromRoutine(routine));
    } else {
      setLoadedId(null);
      setForm(defaultForm());
    }
  }, [open, routine, loadedId]);

  const compiled = compileSchedule(form);
  const preview = useMemo(() => {
    if (!compiled.schedule) return null;
    try {
      const count = compiled.schedule.kind === "once" ? 1 : 3;
      return {
        sentence: describeSchedule(compiled.schedule),
        times: previewFireTimes(compiled.schedule, new Date(), count).map((time) =>
          formatIst(time),
        ),
      };
    } catch {
      return null;
    }
  }, [compiled.schedule]);

  const set = <K extends keyof EditorForm>(key: K, value: EditorForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const save = async () => {
    if (bots === null || bots.length === 0) {
      toast.error("Create a bot first");
      return;
    }
    if (!form.botId || !form.prompt.trim()) {
      toast.error("Pick a bot and write a prompt");
      return;
    }
    if (!compiled.schedule) {
      toast.error(compiled.error);
      return;
    }
    setSaving(true);
    try {
      const base = {
        botId: form.botId,
        name: form.name.trim() || nameFromPrompt(form.prompt),
        prompt: form.prompt.trim(),
        schedule: compiled.schedule,
      };
      if (routine) {
        await update.mutateAsync({
          id: routine.id,
          input: { ...base, progress: form.progress.trim() || null },
        });
      } else await create.mutateAsync(base);
      toast.success(routine ? "Routine saved" : "Routine created");
      await onSaved();
    } catch (error) {
      toast.error(errorMessage(error, "Failed to save routine"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{routine ? "Edit routine" : "New routine"}</DialogTitle>
          <DialogDescription>
            Times are read in IST. The preview shows the next 3 runs before you save.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Bot</Label>
              <Select value={form.botId} onValueChange={(v) => set("botId", v)}>
                <SelectTrigger aria-label="Bot" className="w-full">
                  <SelectValue placeholder={bots === null ? "Loading bots…" : "Pick a bot"} />
                </SelectTrigger>
                <SelectContent position="popper" className="max-h-72">
                  {(bots ?? []).map((bot) => (
                    <SelectItem key={bot.id} value={bot.id}>
                      {bot.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="routine-prompt">Prompt</Label>
              <Textarea
                id="routine-prompt"
                rows={4}
                className="min-h-24"
                value={form.prompt}
                maxLength={MAX_PROMPT_CHARS}
                onChange={(e) => set("prompt", e.target.value)}
                placeholder="What should the bot do each run?"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="routine-name">
                Name <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="routine-name"
                value={form.name}
                maxLength={MAX_NAME_CHARS}
                onChange={(e) => set("name", e.target.value)}
                placeholder={nameFromPrompt(form.prompt) || "e.g. Morning digest"}
              />
            </div>

            <ScheduleFields form={form} set={set} />

            {routine && (
              <div className="space-y-2">
                <Label htmlFor="routine-progress">Progress note</Label>
                <Textarea
                  id="routine-progress"
                  rows={3}
                  value={form.progress}
                  maxLength={MAX_PROGRESS_CHARS}
                  onChange={(e) => set("progress", e.target.value)}
                  placeholder="Empty. A run can keep notes here for the next run."
                />
                <p className="text-xs text-muted-foreground">
                  The routine's runs write this with save_routine_progress, and the next run reads
                  it. Clear it to start over.
                </p>
              </div>
            )}

            <div className="rounded-lg bg-muted/40 px-3 py-3">
              <p className={cn(metaLabelClass, "mb-1.5")}>Preview</p>
              {compiled.schedule && preview ? (
                <>
                  <p className="text-sm">{preview.sentence}</p>
                  <ul className="mt-1.5 space-y-0.5">
                    {preview.times.map((time) => (
                      <li key={time} className="text-xs text-muted-foreground">
                        {time}
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">{compiled.error}</p>
              )}
            </div>
          </div>
        </DialogBody>

        <DialogFooter className="sm:justify-between">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => void save()}
            disabled={saving || !compiled.schedule || !form.botId || !form.prompt.trim()}
          >
            {routine ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
