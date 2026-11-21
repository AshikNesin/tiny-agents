import { Button } from "@groot/ui/button";
import { Input } from "@groot/ui/input";
import { Textarea } from "@groot/ui/textarea";
import { Label } from "@groot/ui/label";
import type { Bot } from "../../../shared/api/bots";
import type { CatalogModel } from "../../../shared/api/models";
import { SYSTEM_PROMPT_MAX, type BotDraft } from "../../lib/bot-draft";
import { ModelSelector } from "../ai-elements/ModelSelector";
import { BotAvatar } from "../BotAvatar";

export function ProfileSection({
  bot,
  draft,
  edit,
  nameError,
  onNameEdited,
  models,
  modelMissing,
  saving,
  onDelete,
}: {
  bot: Bot | null | undefined;
  draft: BotDraft;
  edit: <K extends keyof BotDraft>(key: K, value: BotDraft[K]) => void;
  nameError: string | null;
  onNameEdited: () => void;
  models: CatalogModel[];
  modelMissing: boolean;
  saving: boolean;
  onDelete: () => void;
}) {
  const { name, description, systemPrompt, modelId } = draft;
  return (
    <>
      <div className="grid gap-1.5">
        <Label htmlFor="bot-name">Name</Label>
        <div className="flex items-center gap-3">
          <BotAvatar name={name || "Bot"} className="size-10 shrink-0" />
          <Input
            id="bot-name"
            value={name}
            onChange={(e) => {
              edit("name", e.target.value);
              onNameEdited();
            }}
            placeholder="e.g. Research helper"
            maxLength={100}
            autoFocus={!bot}
            aria-invalid={nameError !== null}
            aria-describedby={nameError ? "bot-name-error" : undefined}
          />
        </div>
        {nameError && (
          <p id="bot-name-error" className="text-xs text-destructive">
            {nameError}
          </p>
        )}
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="bot-description">Description</Label>
        <Input
          id="bot-description"
          value={description}
          onChange={(e) => edit("description", e.target.value)}
          placeholder="One line, shown under the name"
          maxLength={200}
        />
      </div>

      <div className="grid gap-1.5">
        <Label>Model</Label>
        <ModelSelector
          models={models}
          value={modelId}
          onChange={(next) => edit("modelId", next)}
          unknownValue={modelMissing ? (bot?.modelId ?? undefined) : undefined}
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="bot-prompt">System prompt</Label>
        <Textarea
          id="bot-prompt"
          value={systemPrompt}
          onChange={(e) => edit("systemPrompt", e.target.value)}
          placeholder="Who is this bot? How should it reply?"
          rows={6}
          maxLength={SYSTEM_PROMPT_MAX}
          aria-describedby="bot-prompt-count"
        />
        {systemPrompt.length > SYSTEM_PROMPT_MAX * 0.8 && (
          <p id="bot-prompt-count" className="text-muted-foreground text-right text-xs">
            {systemPrompt.length.toLocaleString()} / {SYSTEM_PROMPT_MAX.toLocaleString()}
          </p>
        )}
      </div>

      {bot && (
        <div className="border-border/60 flex items-center gap-3 border-t pt-4 sm:hidden">
          <p className="text-muted-foreground min-w-0 flex-1 text-xs">
            Deletes the bot and its chat history.
          </p>
          <Button
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={onDelete}
            disabled={saving}
          >
            Delete bot
          </Button>
        </div>
      )}
    </>
  );
}
