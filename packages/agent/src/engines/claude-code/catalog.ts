import type { ModelInfo } from "../../types";
import { CLAUDE_CODE_MODEL_PREFIX, CLAUDE_PLAN_NOTE } from "../../engine";

interface ClaudePlanModel {
  id: string;
  name: string;
  reasoning: boolean;
  contextWindow: number;
  vision: boolean;
}

/** Models the picker offers. The worker passes the bare id through to Claude Code. */
const CLAUDE_PLAN_MODELS: readonly ClaudePlanModel[] = [
  {
    id: "claude-opus-4-6",
    name: "Claude Opus 4.6",
    reasoning: true,
    contextWindow: 200_000,
    vision: true,
  },
  {
    id: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    reasoning: true,
    contextWindow: 200_000,
    vision: true,
  },
  {
    id: "claude-haiku-4-5",
    name: "Claude Haiku 4.5",
    reasoning: true,
    contextWindow: 200_000,
    vision: true,
  },
];

/** Catalog entries for the model picker. Not a pi-ai provider and not called from here. */
export function claudePlanModels(): ModelInfo[] {
  return CLAUDE_PLAN_MODELS.map((model) => ({
    id: `${CLAUDE_CODE_MODEL_PREFIX}${model.id}`,
    name: model.name,
    family: "claude-plan",
    reasoning: model.reasoning,
    contextWindow: model.contextWindow,
    vision: model.vision,
    note: CLAUDE_PLAN_NOTE,
  }));
}
