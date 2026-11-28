import { parseEach } from "@tiny-agents/std";
import { z } from "zod";

function orAbsent<T>(value: T | null | undefined): T | undefined {
  return value ?? undefined;
}

export const opt = <T>(schema: z.ZodType<T>) => schema.nullish().transform(orAbsent);

export type ReportInvalid = (what: string, problem: string) => void;

export const listOf = <T>(what: string, schema: z.ZodType<T>, report: ReportInvalid) =>
  z
    .preprocess((value) => (Array.isArray(value) ? value : []), z.array(z.unknown()))
    .transform((values) => parseEach(values, schema, (_value, problem) => report(what, problem)));

export interface ShelleyRow {
  conversation_id: string;
  slug?: string | null;
  parent_conversation_id?: string | null;
  cwd?: string | null;
  model?: string | null;
  updated_at: string;
  created_at: string;
  archived?: boolean;
  user_initiated?: boolean;
  working?: boolean;
  agent_working?: boolean;
  preview?: string;
  max_sequence_id?: number;
  subagent_count?: number;
  running_background_jobs?: number;
  queued_messages?: string;
  turn_interrupted?: boolean;
  git_repo_root?: string;
  git_commit?: string;
  git_subject?: string;
  tags?: string | string[];
  [field: string]: unknown;
}

const rowShape = {
  conversation_id: z.string(),
  slug: z.string().nullish(),
  parent_conversation_id: z.string().nullish(),
  cwd: z.string().nullish(),
  model: z.string().nullish(),
  updated_at: z.string(),
  created_at: z.string(),
  archived: opt(z.boolean()),
  user_initiated: opt(z.boolean()),
  working: opt(z.boolean()),
  agent_working: opt(z.boolean()),
  preview: opt(z.string()),
  max_sequence_id: opt(z.number()),
  subagent_count: opt(z.number()),
  running_background_jobs: opt(z.number()),
  queued_messages: opt(z.string()),
  turn_interrupted: opt(z.boolean()),
  git_repo_root: opt(z.string()),
  git_commit: opt(z.string()),
  git_subject: opt(z.string()),
  tags: opt(z.union([z.string(), z.array(z.string())])),
};

export const rowSchema: z.ZodType<ShelleyRow> = z.looseObject(rowShape);

const conversationSchema: z.ZodType<Partial<ShelleyRow>> = z.looseObject({
  ...rowShape,
  conversation_id: opt(z.string()),
  updated_at: opt(z.string()),
  created_at: opt(z.string()),
});

export interface ShelleyMessage {
  message_id: string;
  conversation_id?: string;
  sequence_id: number;
  type: string;
  llm_data?: string | null;
  user_data?: string | null;
  usage_data?: string | null;
  other_usage_data?: string | null;
  display_data?: string | null;
  created_at: string;
  end_of_turn?: boolean | null;
  model_name?: string | null;
  generation?: number;
}

const messageSchema: z.ZodType<ShelleyMessage> = z.looseObject({
  message_id: z.string(),
  conversation_id: opt(z.string()),
  sequence_id: z.number(),
  type: z.string(),
  llm_data: z.string().nullish(),
  user_data: z.string().nullish(),
  usage_data: z.string().nullish(),
  other_usage_data: z.string().nullish(),
  display_data: z.string().nullish(),
  created_at: z.string(),
  end_of_turn: z.boolean().nullish(),
  model_name: z.string().nullish(),
  generation: opt(z.number()),
});

export interface ShelleyFrame {
  conversation_id?: string;
  messages?: ShelleyMessage[];
  conversation?: ShelleyRow;
  conversation_state?: { conversation_id?: string; working: boolean; model?: string };
  context_window_size?: number;
  tool_progress?: { tool_use_id: string; tool_name: string; output: string };
  stream_delta?: { type: "text" | "thinking" | "tool_input"; text: string; index?: number };
  conversation_list_patch?: unknown;
  notification_event?: {
    type?: string;
    conversation_id?: string;
    payload?: { final_response?: string; conversation_title?: string };
  };
  heartbeat?: boolean;
  [field: string]: unknown;
}

export interface ShelleyDetail {
  messages?: ShelleyMessage[];
  conversation?: Partial<ShelleyRow>;
  context_window_size?: number;
  max_sequence_id?: number;
}

export const detailSchemaOf = (report: ReportInvalid): z.ZodType<ShelleyDetail> =>
  z.looseObject({
    messages: listOf("a Shelley message", messageSchema, report),
    conversation: opt(conversationSchema),
    context_window_size: opt(z.number()),
    max_sequence_id: opt(z.number()),
  });

export interface ShelleyModel {
  id: string;
  display_name?: string;
  ready?: boolean;
  is_default?: boolean;
  max_context_tokens?: number;
  supports_images?: boolean;
  supports_reasoning?: boolean;
}

export const modelSchema: z.ZodType<ShelleyModel> = z.looseObject({
  id: z.string(),
  display_name: opt(z.string()),
  ready: opt(z.boolean()),
  is_default: opt(z.boolean()),
  max_context_tokens: opt(z.number()),
  supports_images: opt(z.boolean()),
  supports_reasoning: opt(z.boolean()),
});

export interface ShelleySettings {
  profile?: string;
  model?: string;
  thinking_level?: string;
}

export const settingsSchema: z.ZodType<ShelleySettings> = z.looseObject({
  profile: opt(z.string()),
  model: opt(z.string()),
  thinking_level: opt(z.string()),
});

export interface SubagentModelUsage {
  model: string;
  url?: string;
  llm_calls: number;
  input_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  output_tokens: number;
  estimated_usd: number;
  reported_usd: number;
}

export interface SubagentUsage {
  llm_calls: number;
  reported_usd: number;
  estimated_usd: number;
  per_model?: SubagentModelUsage[];
}

const subagentModelUsageSchema: z.ZodType<SubagentModelUsage> = z.looseObject({
  model: z.string(),
  url: opt(z.string()),
  llm_calls: z.number(),
  input_tokens: z.number(),
  cache_creation_input_tokens: z.number(),
  cache_read_input_tokens: z.number(),
  output_tokens: z.number(),
  estimated_usd: z.number(),
  reported_usd: z.number(),
});

export const subagentUsageSchemaOf = (report: ReportInvalid): z.ZodType<SubagentUsage> =>
  z.looseObject({
    llm_calls: z.number(),
    reported_usd: z.number(),
    estimated_usd: z.number(),
    per_model: listOf("a subagent's model usage", subagentModelUsageSchema, report),
  });

export interface ModelCost {
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
}

export const modelCostsSchema = z.looseObject({
  costs: opt(
    z.record(
      z.string(),
      z
        .looseObject({
          input: z.number(),
          output: z.number(),
          cache_read: z.number(),
          cache_write: z.number(),
        })
        .nullable(),
    ),
  ),
});

export function isWorking(row: Pick<ShelleyRow, "working" | "agent_working"> | undefined): boolean {
  return Boolean(row?.working ?? row?.agent_working);
}

export const TINY_AGENTS_TAG = "tiny-agents";

export function tagsOf(row: Pick<ShelleyRow, "tags"> | undefined): string[] {
  let tags: unknown = row?.tags;
  if (typeof tags === "string") {
    try {
      tags = JSON.parse(tags);
    } catch {
      return [];
    }
  }
  return Array.isArray(tags) ? tags.filter((t): t is string => typeof t === "string") : [];
}
