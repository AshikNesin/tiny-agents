/**
 * The bot dialog's form, without React: a draft starts from a Bot (or from
 * nothing, with the default model), takes edits field by field, and turns
 * into the create/update payload once it is valid. The dialog is its view.
 */
import type { Bot, BrowserProfile, ModelInfo, ToolPermission } from "./bots-api";

/** The server caps the persona at ~24 KB (bots.schema.ts). */
export const SYSTEM_PROMPT_MAX = 24_576;

export interface BotDraft {
  name: string;
  description: string;
  systemPrompt: string;
  modelId: string;
  toolPermissions: Record<string, ToolPermission>;
  skillIds: string[];
  connectionIds: string[];
  browserProfile: BrowserProfile;
  autoReview: boolean;
}

/** What `botsApi.create` / `botsApi.update` take. */
export type BotPayload = BotDraft;

/** The model a new bot starts with: the owner's default, else the first in the catalog. */
export function fallbackModelId(
  defaultModelId: string | undefined,
  models: readonly Pick<ModelInfo, "id">[],
): string | undefined {
  return defaultModelId ?? models[0]?.id;
}

/** A draft of `bot`, or of a new bot on `modelId` when there is none. */
export function draftFrom(bot: Bot | null | undefined, modelId: string | undefined): BotDraft {
  return {
    name: bot?.name ?? "",
    description: bot?.description ?? "",
    systemPrompt: bot?.systemPrompt ?? "",
    modelId: bot?.modelId ?? modelId ?? "",
    toolPermissions: bot?.toolPermissions ?? {},
    skillIds: bot?.skillIds ?? [],
    connectionIds: bot?.connectionIds ?? [],
    browserProfile: bot?.browserProfile ?? "shared",
    autoReview: bot?.autoReview ?? false,
  };
}

/** Why the draft cannot be saved yet, or undefined when it can. */
export function draftProblem(draft: BotDraft): string | undefined {
  if (!draft.name.trim() || !draft.modelId) return "Name and model are required";
  return undefined;
}

export function canSaveDraft(draft: BotDraft): boolean {
  return draftProblem(draft) === undefined;
}

/** The payload for a valid draft: names trimmed, the rest as edited. */
export function draftPayload(draft: BotDraft): BotPayload {
  return { ...draft, name: draft.name.trim(), description: draft.description.trim() };
}

/** Add or drop an id from a selection (a skill, a connection). */
export function toggleId(ids: readonly string[], id: string, on: boolean): string[] {
  return on
    ? ids.includes(id)
      ? [...ids]
      : [...ids, id]
    : ids.filter((existing) => existing !== id);
}
