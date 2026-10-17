import { useEffect, useMemo, useState } from "react";
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
import { toast } from "sonner";
import { botsApi, type Bot, type ModelInfo } from "../lib/bots-api";
import { BotAvatar } from "./BotAvatar";

const AVATAR_COLORS = [
  "#14b8a6",
  "#0ea5e9",
  "#8b5cf6",
  "#f43f5e",
  "#f59e0b",
  "#10b981",
  "#6366f1",
  "#ec4899",
];

const EMOJI_CHOICES = ["🤖", "🧠", "🔎", "📝", "🧪", "📊", "🛠️", "🌿", "🎯", "💬", "⚡", "🧭"];

interface BotDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  models: ModelInfo[];
  defaultModelId?: string;
  /** Existing bot to edit; omitted = create. */
  bot?: Bot | null;
  onSaved: (bot: Bot) => void;
}

/**
 * Single-page create/edit bot dialog: name, description, avatar, model,
 * system prompt (PRD §6.3 — deliberately not a wizard).
 */
export function BotDialog({
  open,
  onOpenChange,
  models,
  defaultModelId,
  bot,
  onSaved,
}: BotDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [modelId, setModelId] = useState("");
  const [avatarEmoji, setAvatarEmoji] = useState<string>("");
  const [avatarColor, setAvatarColor] = useState(AVATAR_COLORS[0]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(bot?.name ?? "");
    setDescription(bot?.description ?? "");
    setSystemPrompt(bot?.systemPrompt ?? "");
    setModelId(bot?.modelId ?? defaultModelId ?? models[0]?.id ?? "");
    setAvatarEmoji(bot?.avatarEmoji ?? "");
    setAvatarColor(
      bot?.avatarColor ?? AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
    );
  }, [open, bot, defaultModelId, models]);

  const modelMissing = Boolean(bot) && !models.some((m) => m.id === bot?.modelId);

  const save = async () => {
    if (!name.trim() || !modelId) {
      toast.error("Name and model are required");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        description: description.trim(),
        systemPrompt,
        modelId,
        avatarColor,
      };
      // Create keeps an undefined emoji (server default); update can clear it.
      const saved = bot
        ? await botsApi.update(bot.id, {
            ...payload,
            avatarEmoji: avatarEmoji || null,
          })
        : await botsApi.create({ ...payload, ...(avatarEmoji ? { avatarEmoji } : {}) });
      onSaved(saved);
      onOpenChange(false);
      toast.success(bot ? "Bot updated" : "Bot created");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save bot");
    } finally {
      setSaving(false);
    }
  };

  const grouped = useMemo(() => {
    const groups = new Map<string, ModelInfo[]>();
    for (const model of models) {
      const list = groups.get(model.family) ?? [];
      list.push(model);
      groups.set(model.family, list);
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [models]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{bot ? `Edit ${bot.name}` : "New bot"}</DialogTitle>
          <DialogDescription>
            {bot
              ? "Prompt and model changes apply from the next turn; history is kept."
              : "A bot is a contact with its own persona and model."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-3">
          <BotAvatar
            name={name || "Bot"}
            emoji={avatarEmoji || null}
            color={avatarColor}
            className="size-12 text-lg"
          />
          <div className="flex-1">
            <Label htmlFor="bot-name">Name</Label>
            <Input
              id="bot-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Research helper"
              maxLength={100}
              autoFocus={!bot}
            />
          </div>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="bot-description">Description</Label>
          <Input
            id="bot-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="One line, shown under the name"
            maxLength={200}
          />
        </div>

        <div className="grid gap-1.5">
          <Label>Avatar</Label>
          <div className="flex flex-wrap items-center gap-1.5">
            {EMOJI_CHOICES.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => setAvatarEmoji(avatarEmoji === emoji ? "" : emoji)}
                className={`rounded-md border p-1.5 text-base ${
                  avatarEmoji === emoji
                    ? "border-primary bg-primary/10"
                    : "border-border hover:bg-muted"
                }`}
                aria-pressed={avatarEmoji === emoji}
              >
                {emoji}
              </button>
            ))}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {AVATAR_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => setAvatarColor(color)}
                className={`size-6 rounded-md ring-offset-2 transition-transform ${
                  avatarColor === color ? "ring-2 ring-ring scale-110" : ""
                }`}
                style={{ backgroundColor: color }}
                aria-label={`Colour ${color}`}
                aria-pressed={avatarColor === color}
              />
            ))}
            <span className="ml-1 text-xs text-muted-foreground">
              {avatarEmoji ? "" : "Initials of the name are used without an emoji"}
            </span>
          </div>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="bot-model">Model</Label>
          <select
            id="bot-model"
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            className="border-input bg-background rounded-md border px-3 py-2 text-sm"
          >
            {modelMissing && (
              <option value={bot?.modelId}>{bot?.modelId} (no longer available)</option>
            )}
            {grouped.map(([family, groupModels]) => (
              <optgroup key={family} label={family}>
                {groupModels.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="bot-prompt">System prompt</Label>
          <Textarea
            id="bot-prompt"
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder="Who is this bot? How should it reply?"
            rows={6}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || !name.trim() || !modelId}>
            {saving ? "Saving…" : bot ? "Save changes" : "Create bot"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
