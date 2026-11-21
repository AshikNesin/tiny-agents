import type { Bot, ToolPermission } from "../../shared/api/bots";
import type { BrowserProfile } from "../../shared/api/live";
import type { CatalogModel } from "../../shared/api/models";

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
  yoloByDefault: boolean;
  guestIds: number[];
}

export type BotPayload = BotDraft;

export function fallbackModelId(
  defaultModelId: string | undefined,
  models: readonly Pick<CatalogModel, "id">[],
): string | undefined {
  return defaultModelId ?? models[0]?.id;
}

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
    yoloByDefault: bot?.yoloByDefault ?? false,
    guestIds: bot?.guestIds ?? [],
  };
}

export function draftProblem(draft: BotDraft): string | undefined {
  if (!draft.name.trim() || !draft.modelId) return "Name and model are required";
  return undefined;
}

export function canSaveDraft(draft: BotDraft): boolean {
  return draftProblem(draft) === undefined;
}

export function draftPayload(draft: BotDraft): BotPayload {
  return { ...draft, name: draft.name.trim(), description: draft.description.trim() };
}

export function toggleId(ids: readonly string[], id: string, on: boolean): string[] {
  return on
    ? ids.includes(id)
      ? [...ids]
      : [...ids, id]
    : ids.filter((existing) => existing !== id);
}
