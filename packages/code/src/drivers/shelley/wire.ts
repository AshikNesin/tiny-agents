/**
 * Shelley's wire format (its API.md and ui/src/types.ts), the fields this
 * driver reads; everything else passes through untouched.
 */

/** A conversation row as Shelley's snapshot serves it. */
export interface ShelleyRow {
  conversation_id: string;
  slug: string | null;
  parent_conversation_id: string | null;
  cwd: string | null;
  model: string | null;
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
  /** A JSON array of strings, as a string (Shelley's `tags` column). */
  tags?: string | string[];
  [field: string]: unknown;
}

export interface ShelleyMessage {
  message_id: string;
  conversation_id?: string;
  sequence_id: number;
  type: string;
  llm_data?: string | null;
  user_data?: string | null;
  usage_data?: string | null;
  /** Indirect LLM usage (compaction, slug generation, …): a JSON array of
   *  usage_data-shaped records with the purpose that incurred them. */
  other_usage_data?: string | null;
  display_data?: string | null;
  created_at: string;
  end_of_turn?: boolean | null;
  model_name?: string | null;
  generation?: number;
}

/** One `stream2` frame. */
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
  conversation?: ShelleyRow;
  context_window_size?: number;
  max_sequence_id?: number;
}

export interface ShelleyModel {
  id: string;
  display_name?: string;
  ready: boolean;
  is_default?: boolean;
  max_context_tokens?: number;
  supports_images?: boolean;
  supports_reasoning?: boolean;
}

export interface ShelleySettings {
  profile?: string;
  model: string;
  thinking_level: string;
}

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

/** models.dev pricing for one model, USD per million tokens. */
export interface ModelCost {
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
}

export function isWorking(row: Pick<ShelleyRow, "working" | "agent_working"> | undefined): boolean {
  return Boolean(row?.working ?? row?.agent_working);
}

/** The tag every conversation tiny-agents starts carries; the Code page lists only these. */
export const TINY_AGENTS_TAG = "tiny-agents";

/** A row's tags: Shelley serves them as a JSON string; anything unreadable is none. */
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
