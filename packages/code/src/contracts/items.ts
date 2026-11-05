/**
 * The normalized transcript. Every harness turns its native messages into
 * these rows at the adapter boundary; the Code page renders only these.
 *
 * Rows have stable ids and are always re-sent whole, so a client keeps
 * `Map<id, item>` and a replay or reconnect is idempotent. `raw` is never
 * needed for generic rendering.
 */

/** How a tool call is drawn. Unknown tools are `other`. */
export type ToolKind =
  | "bash"
  | "edit"
  | "read"
  | "search"
  | "web"
  | "browser"
  | "image"
  | "todo"
  | "subagent"
  | "message_user"
  | "message_parent"
  | "change_dir"
  | "mcp"
  | "other";

/**
 * An asset the harness serves (a screenshot, an uploaded file). `ref` is
 * opaque to everyone but the driver; the app serves it at
 * `/code/threads/:id/asset?ref=`.
 */
export interface AssetRef {
  ref: string;
  name: string;
  image: boolean;
}

export interface ToolItem {
  kind: "tool";
  id: string;
  tool: ToolKind;
  /** The harness's own tool name (`bash`, `Edit`, `mcp__x__y`). */
  name: string;
  input: unknown;
  /** One-line gist: the command, the file path, the subagent's name. */
  summary: string;
  status: "running" | "done" | "error" | "denied";
  /** Result text, or the live tail while it runs (`live`). */
  output?: string;
  live?: boolean;
  durationMs?: number;
  /** A unified diff the call produced (edits). */
  diff?: { path: string; diff: string };
  /** A subagent thread this call started. */
  child?: { threadId: string; title: string };
  exitCode?: number;
  background?: boolean;
  images: AssetRef[];
}

export type ApprovalRequest =
  | {
      kind: "tool";
      tool: ToolKind;
      name: string;
      input: unknown;
      summary: string;
      /** Why the harness asks (its own wording), when it says. */
      reason?: string;
    }
  | {
      kind: "question";
      questions: Array<{
        question: string;
        header?: string;
        multiSelect?: boolean;
        options: Array<{ label: string; description?: string }>;
      }>;
    };

export type RequestAnswer =
  | { decision: "allow" | "deny"; message?: string }
  | { answers: Record<string, string> };

export type TranscriptItem =
  | {
      kind: "user";
      id: string;
      text: string;
      attachments: AssetRef[];
      /** Where a fork can start (capability `threads.fork`). */
      forkAt?: string;
    }
  | { kind: "assistant"; id: string; text: string }
  | { kind: "thinking"; id: string; text: string }
  /** A subagent reporting back into its parent. */
  | { kind: "report"; id: string; from: string; text: string }
  /** A background job finished. */
  | { kind: "job"; id: string; text: string; exitCode?: number }
  | {
      kind: "notice";
      id: string;
      level: "error" | "warning" | "info";
      text: string;
      retryable?: boolean;
      refusal?: boolean;
      code?: "usage_limit" | "auth" | "harness";
      resetsAt?: string;
    }
  | { kind: "turn"; id: string; durationMs?: number; costUsd?: number }
  | {
      kind: "request";
      id: string;
      request: ApprovalRequest;
      status: "open" | "allowed" | "denied" | "answered" | "expired";
    }
  | ToolItem;

export type TranscriptItemKind = TranscriptItem["kind"];
