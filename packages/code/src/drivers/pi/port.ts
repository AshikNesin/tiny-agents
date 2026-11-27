import type { ModelOption, PermissionMode, Skill } from "../../contracts";

type PiToolStatus =
  | "pending"
  | "running"
  | "awaiting_approval"
  | "awaiting_answer"
  | "done"
  | "error"
  | "awaiting_credentials"
  | "awaiting_takeover"
  | "denied"
  | "expired"
  | "interrupted"
  | "aborted";

interface PiQuestion {
  question: string;
  description?: string;
  options?: { label: string; description?: string }[];
  multiple?: boolean;
}

export interface PiAnswer {
  selected: string[];
  text?: string;
}

export interface PiToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: PiToolStatus;
  output?: string;
  durationMs?: number;
  taskId?: number;
  approval?: "approved" | "denied" | "auto" | "yolo" | "refused";
  exitCode?: number;
  diff?: { path: string; diff: string };
  questions?: PiQuestion[];
  answers?: PiAnswer[];
}

export interface PiMessage {
  id: string;
  role: "user" | "assistant" | "marker";
  text: string;
  toolCalls?: PiToolCall[];
  reasoning?: string;
  status: "done" | "streaming" | "stopped" | "error" | "unanswered";
  error?: string;
  createdAt: number;
}

export interface PiQueued {
  requestId: string;
  mode: "steer" | "followUp";
  text: string;
  createdAt?: number;
}

export interface PiChatState {
  messages: PiMessage[];
  busy: boolean;
  readonly queued: readonly PiQueued[];
}

export type PiChatEvent =
  | { type: "snapshot"; state: PiChatState }
  | { type: "upsert"; message: PiMessage }
  | { type: "remove"; id: string }
  | { type: "delta"; id: string; text?: string; reasoning?: string }
  | { type: "queued"; items: readonly PiQueued[] }
  | { type: "busy"; busy: boolean };

export interface PiThreadConfig {
  modelId: string;
  cwd: string;
  permissionMode: PermissionMode;
}

interface PiActivity {
  conversation: number;
  busy: boolean;
  approvals: number;
  questions: number;
}

export interface PiPort {
  models(): ModelOption[];
  skills(cwd: string): Promise<Skill[]>;
  create(config: PiThreadConfig): Promise<number>;
  configure(ref: number, config: PiThreadConfig): Promise<void>;
  submit(
    ref: number,
    input: { requestId: string; text: string; whenBusy: "steer" | "followUp" },
  ): Promise<void>;
  abort(ref: number): Promise<void>;
  withdraw(
    ref: number,
    requestId: string,
  ): Promise<"withdrawn" | "already_placed" | "settled" | "not_found">;
  fork(ref: number, atMessageId: string): Promise<number>;
  compact(ref: number, instructions?: string): Promise<void>;
  continueReply(ref: number): Promise<void>;
  decideApproval(ref: number, taskId: number, decision: "approved" | "denied"): Promise<void>;
  answerQuestions(ref: number, taskId: number, answers: PiAnswer[]): Promise<void>;
  isBusy(ref: number): boolean;
  costUsd(ref: number): Promise<number>;
  read(ref: number): Promise<PiChatState>;
  watch(ref: number, listener: (events: PiChatEvent[]) => void): Promise<{ stop(): Promise<void> }>;
  onActivity(listener: (change: PiActivity) => void): () => void;
}

export function applyChatEvents(
  state: PiChatState | undefined,
  events: readonly PiChatEvent[],
): PiChatState | undefined {
  let next = state;
  for (const event of events) {
    if (event.type === "snapshot") {
      next = { ...event.state, messages: [...event.state.messages] };
      continue;
    }
    if (!next) continue;
    switch (event.type) {
      case "upsert": {
        const at = next.messages.findIndex((message) => message.id === event.message.id);
        const messages = [...next.messages];
        if (at >= 0) messages[at] = event.message;
        else messages.push(event.message);
        next = { ...next, messages };
        break;
      }
      case "remove":
        next = {
          ...next,
          messages: next.messages.filter((message) => message.id !== event.id),
        };
        break;
      case "delta":
        next = {
          ...next,
          messages: next.messages.map((message) =>
            message.id === event.id
              ? {
                  ...message,
                  text: message.text + (event.text ?? ""),
                  ...(event.reasoning
                    ? { reasoning: (message.reasoning ?? "") + event.reasoning }
                    : {}),
                }
              : message,
          ),
        };
        break;
      case "queued":
        next = { ...next, queued: event.items };
        break;
      case "busy":
        next = { ...next, busy: event.busy };
        break;
    }
  }
  return next;
}
