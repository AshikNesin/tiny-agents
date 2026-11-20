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

export interface AssetRef {
  ref: string;
  name: string;
  image: boolean;
}

export interface ToolItem {
  kind: "tool";
  id: string;
  tool: ToolKind;
  name: string;
  input: unknown;
  summary: string;
  status: "running" | "done" | "error" | "denied";
  output?: string;
  live?: boolean;
  durationMs?: number;
  diff?: { path: string; diff: string };
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
      forkAt?: string;
    }
  | { kind: "assistant"; id: string; text: string }
  | { kind: "thinking"; id: string; text: string }
  | { kind: "report"; id: string; from: string; text: string }
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
