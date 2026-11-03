/**
 * The Code page's client for Shelley, through this app's `/shelley` proxy
 * (apps/web/src/server/api/shelley/shelley.routes.ts), plus the pure fold
 * from Shelley's stored messages to the rows the page renders.
 *
 * Shelley's wire format (its API.md): message rows carry `llm_data` as a JSON
 * string holding `{ Role, Content: [...] }`, and each content block's `Type`
 * is a number (Go iota): 2 text, 3 thinking, 5 tool use, 6 tool result.
 */
import { apiClient } from "@groot/shell/lib/api";

export interface ShelleyStatus {
  configured: boolean;
  url: string | null;
}

export interface ShelleyConversation {
  conversation_id: string;
  slug: string | null;
  cwd: string | null;
  model: string | null;
  created_at: string;
  updated_at: string;
  agent_working?: boolean;
  working?: boolean;
  preview?: string;
}

export interface ShelleyModel {
  id: string;
  display_name?: string;
  ready: boolean;
}

export interface ShelleyMessage {
  message_id: string;
  sequence_id: number;
  type: string;
  llm_data?: string | null;
  created_at: string;
  end_of_turn?: boolean | null;
}

/** One frame of `GET /api/conversation/<id>/stream`, as relayed by our proxy. */
export interface ShelleyStreamEvent {
  type?: string; // our proxy's own "ping" / "error" frames
  message?: string;
  messages?: ShelleyMessage[];
  conversation?: ShelleyConversation;
  conversation_state?: { working: boolean; model?: string };
  tool_progress?: { tool_use_id: string; tool_name: string; output: string };
  stream_delta?: { type: string; text: string };
}

export const shelleyApi = {
  status: () => apiClient.get<ShelleyStatus>("/shelley/status"),
  models: () => apiClient.get<ShelleyModel[]>("/shelley/models"),
  list: () => apiClient.get<ShelleyConversation[]>("/shelley/conversations"),
  create: (input: { message: string; cwd?: string; model?: string }) =>
    apiClient.post<{ conversationId: string }>("/shelley/conversations", input),
  chat: (id: string, message: string, queue = false) =>
    apiClient.post<{ status: string }>(`/shelley/conversations/${id}/chat`, { message, queue }),
  cancel: (id: string) => apiClient.post(`/shelley/conversations/${id}/cancel`),
  streamPath: (id: string) => `/api/v1/shelley/conversations/${encodeURIComponent(id)}/stream`,
};

export function conversationTitle(c: Pick<ShelleyConversation, "slug" | "conversation_id">) {
  return c.slug || c.conversation_id;
}

// --- transcript ----------------------------------------------------------

const TEXT = 2;
const THINKING = 3;
const TOOL_USE = 5;
const TOOL_RESULT = 6;
const SERVER_TOOL_USE = 7;

interface ContentBlock {
  ID?: string;
  Type?: number;
  Text?: string;
  Thinking?: string;
  ToolName?: string;
  ToolInput?: unknown;
  ToolUseID?: string;
  ToolError?: boolean;
  ToolResult?: ContentBlock[];
  ToolUseStartTime?: string;
  ToolUseEndTime?: string;
}

export interface ToolCall {
  kind: "tool";
  key: string;
  name: string;
  input: unknown;
  /** One-line gist of the input: the bash command, the file path, … */
  summary: string;
  /** The result text, or the live tail of its output while it runs. */
  output?: string;
  status: "running" | "done" | "error";
  durationMs?: number;
}

export type TranscriptItem =
  | { kind: "user"; key: string; text: string }
  | { kind: "assistant"; key: string; text: string }
  | { kind: "thinking"; key: string; text: string }
  | { kind: "notice"; key: string; text: string }
  | ToolCall;

function parseLlmData(raw: string | null | undefined): ContentBlock[] {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw) as { Content?: ContentBlock[] };
    return Array.isArray(data.Content) ? data.Content : [];
  } catch {
    return [];
  }
}

function textOf(blocks: ContentBlock[] | undefined): string {
  return (blocks ?? [])
    .filter((b) => b.Type === TEXT && b.Text)
    .map((b) => b.Text)
    .join("\n");
}

function summarize(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const record = input as Record<string, unknown>;
  const preferred = ["command", "path", "url", "query", "pattern", "thoughts"];
  const key =
    preferred.find((k) => typeof record[k] === "string") ??
    Object.keys(record).find((k) => typeof record[k] === "string");
  const value = key ? String(record[key]) : "";
  const line = value.split("\n")[0].trim();
  return line.length > 120 ? `${line.slice(0, 117)}…` : line;
}

/**
 * Fold Shelley's messages (any order, duplicates allowed) into display rows:
 * user and assistant text, thinking, and one row per tool call with its
 * result attached. `progress` is the live output tail of running tools.
 */
export function buildTranscript(
  messages: Iterable<ShelleyMessage>,
  progress: Record<string, string> = {},
): TranscriptItem[] {
  const sorted = [...messages].sort((a, b) => a.sequence_id - b.sequence_id);
  const items: TranscriptItem[] = [];
  const calls = new Map<string, ToolCall>();

  for (const message of sorted) {
    if (!["user", "agent", "tool", "error", "warning"].includes(message.type)) continue;
    const blocks = parseLlmData(message.llm_data);
    if (message.type === "error" || message.type === "warning") {
      const text = textOf(blocks);
      if (text) items.push({ kind: "notice", key: message.message_id, text });
      continue;
    }
    blocks.forEach((block, i) => {
      const key = `${message.message_id}:${i}`;
      if (block.Type === TEXT && block.Text?.trim()) {
        items.push({
          kind: message.type === "agent" ? "assistant" : "user",
          key,
          text: block.Text,
        });
      } else if (block.Type === THINKING && block.Thinking?.trim()) {
        items.push({ kind: "thinking", key, text: block.Thinking });
      } else if ((block.Type === TOOL_USE || block.Type === SERVER_TOOL_USE) && block.ID) {
        const call: ToolCall = {
          kind: "tool",
          key: block.ID,
          name: block.ToolName ?? "tool",
          input: block.ToolInput,
          summary: summarize(block.ToolInput),
          status: "running",
          output: progress[block.ID],
        };
        calls.set(block.ID, call);
        items.push(call);
      } else if (block.Type === TOOL_RESULT && block.ToolUseID) {
        const call = calls.get(block.ToolUseID);
        if (!call) return;
        call.status = block.ToolError ? "error" : "done";
        call.output = textOf(block.ToolResult) || call.output;
        if (block.ToolUseStartTime && block.ToolUseEndTime) {
          const ms = Date.parse(block.ToolUseEndTime) - Date.parse(block.ToolUseStartTime);
          if (Number.isFinite(ms) && ms >= 0) call.durationMs = ms;
        }
      }
    });
  }
  return items;
}
