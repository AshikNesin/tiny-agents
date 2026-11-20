import type { AssistantMessage } from "@earendil-works/pi-ai";
import type {
  AgentEvent,
  EntryRecord,
  MessageChange,
  SubmissionRecord,
  ToolSlot,
} from "@earendil-works/pi-durable";
import type { LiveTool } from "./tool-call-row";
import { chatState, diffChat, windowChat, type RawChat } from "./transcript";
import type { ChatEvent, ChatState, QueuedMessage } from "./types";

export interface ProjectionSnapshot {
  entries: readonly EntryRecord[];
  live?: AssistantMessage;
  busy: boolean;
  tools: readonly ToolSlot[];
  queued?: readonly QueuedMessage[];
  unanswered?: ReadonlyMap<number, string>;
}

export interface FoldOutcome {
  resnapshot: boolean;
  inboxChanged: boolean;
}

export function unansweredOf(records: Iterable<SubmissionRecord>): Map<number, string> {
  const out = new Map<number, string>();
  for (const record of records) {
    if (record.type === "input" && record.status === "unanswered" && record.entry !== undefined) {
      out.set(Number(record.entry), record.reason);
    }
  }
  return out;
}

function liveTools(slots: readonly ToolSlot[]): Map<string, LiveTool> {
  const tools = new Map<string, LiveTool>();
  for (const slot of slots) {
    tools.set(slot.callId, {
      status: slot.status,
      ...(slot.taskId !== undefined ? { taskId: Number(slot.taskId) } : {}),
      ...(slot.output ? { output: slot.output } : {}),
      ...(slot.details !== undefined ? { details: slot.details } : {}),
    });
  }
  return tools;
}

export class ChatProjection {
  readonly #entries = new Map<number, EntryRecord>();
  #live: AssistantMessage | undefined;
  #busy = false;
  #tools = new Map<string, LiveTool>();
  #queued: readonly QueuedMessage[] = [];
  readonly #unanswered = new Map<number, string>();
  readonly #window: number | undefined;
  #from: string | undefined;
  #shown: ChatState;

  constructor(snapshot: ProjectionSnapshot, options: { window?: number } = {}) {
    this.#window = options.window;
    this.#load(snapshot);
    this.#shown = this.#windowed(true)!;
  }

  get state(): ChatState {
    return this.#shown;
  }

  full(): ChatState {
    return chatState(this.#raw());
  }

  reset(snapshot: ProjectionSnapshot): void {
    this.#entries.clear();
    this.#unanswered.clear();
    this.#load(snapshot);
    this.#from = undefined;
  }

  setQueued(queued: readonly QueuedMessage[]): void {
    this.#queued = queued;
  }

  fold(events: readonly AgentEvent[]): FoldOutcome {
    const outcome: FoldOutcome = { resnapshot: false, inboxChanged: false };
    for (const event of events) {
      if (event.type === "snapshot") {
        outcome.resnapshot = true;
        continue;
      }
      if (event.type === "inbox_update") {
        outcome.inboxChanged = true;
        continue;
      }
      this.apply(event);
    }
    return outcome;
  }

  apply(event: AgentEvent): void {
    switch (event.type) {
      case "tool_execution_start":
        if (event.parentToolCallId === undefined) {
          this.#tools.set(event.toolCallId, {
            status: "running",
            ...(event.taskId !== undefined ? { taskId: Number(event.taskId) } : {}),
          });
        }
        break;
      case "tool_execution_update": {
        const slot = this.#tools.get(event.toolCallId);
        if (!slot || event.parentToolCallId !== undefined) break;
        const next: LiveTool = { ...slot };
        if (event.details !== undefined) next.details = event.details ?? undefined;
        if (event.output) {
          next.output =
            "set" in event.output
              ? event.output.set
              : (slot.output ?? "").slice(event.output.trimStart ?? 0) +
                (event.output.append ?? "");
        }
        this.#tools.set(event.toolCallId, next);
        break;
      }
      case "tool_execution_end":
        if (event.parentToolCallId !== undefined) break;
        this.#tools.delete(event.toolCallId);
        if (event.entry) this.#entries.set(Number(event.entry.id), event.entry);
        break;
      case "message_start":
        if (event.message.role === "assistant") this.#live = structuredClone(event.message);
        break;
      case "message_update":
        if (this.#live) {
          for (const change of event.changes) this.#live = applyChange(this.#live, change);
        }
        break;
      case "message_end":
        this.#entries.set(Number(event.entry.id), event.entry);
        if (event.entry.kind === "pi.assistant") this.#live = undefined;
        break;
      case "entry_appended":
        this.#entries.set(Number(event.entry.id), event.entry);
        break;
      case "run_start":
        this.#busy = true;
        break;
      case "run_end":
        this.#busy = false;
        this.#live = undefined;
        this.#tools.clear();
        break;
      case "submission":
        if (
          event.record.type === "input" &&
          event.record.status === "unanswered" &&
          event.record.entry !== undefined
        ) {
          this.#unanswered.set(Number(event.record.entry), event.record.reason);
        }
        break;
      default:
        break;
    }
  }

  flush(options: { resnapshot?: boolean } = {}): ChatEvent[] {
    let resnapshot = options.resnapshot === true;
    const kept = resnapshot ? undefined : this.#windowed(false);
    if (!kept) resnapshot = true;
    const next = kept ?? this.#windowed(true)!;
    const events = resnapshot
      ? [{ type: "snapshot", state: next } as ChatEvent]
      : diffChat(this.#shown, next);
    this.#shown = next;
    return events;
  }

  #load(snapshot: ProjectionSnapshot): void {
    for (const entry of snapshot.entries) this.#entries.set(Number(entry.id), entry);
    this.#live = snapshot.live ? structuredClone(snapshot.live) : undefined;
    this.#busy = snapshot.busy;
    this.#tools = liveTools(snapshot.tools);
    if (snapshot.queued) this.#queued = snapshot.queued;
    for (const [entry, reason] of snapshot.unanswered ?? []) this.#unanswered.set(entry, reason);
  }

  #raw(): RawChat {
    return {
      entries: [...this.#entries.values()],
      live: this.#live,
      busy: this.#busy,
      unanswered: this.#unanswered,
      tools: this.#tools,
      queued: this.#queued,
    };
  }

  #windowed(fresh: boolean): ChatState | undefined {
    const full = this.full();
    if (this.#window === undefined) return full;
    const next = fresh
      ? windowChat(full, this.#window)
      : windowChat(full, Number.POSITIVE_INFINITY, this.#from);
    if (next) this.#from = next.hasMore ? next.cursor : undefined;
    return next;
  }
}

function applyChange(message: AssistantMessage, change: MessageChange): AssistantMessage {
  if (change.type === "message") return structuredClone(change.message);
  const content = [...message.content];
  switch (change.type) {
    case "text_start":
    case "thinking_start":
    case "toolcall_start":
    case "block":
      content[change.contentIndex] = structuredClone(change.block);
      break;
    case "text_delta": {
      const block = content[change.contentIndex];
      content[change.contentIndex] =
        block?.type === "text"
          ? { ...block, text: block.text + change.delta }
          : { type: "text", text: change.delta };
      break;
    }
    case "thinking_delta": {
      const block = content[change.contentIndex];
      content[change.contentIndex] =
        block?.type === "thinking"
          ? { ...block, thinking: block.thinking + change.delta }
          : { type: "thinking", thinking: change.delta };
      break;
    }
    default:
      break;
  }
  return { ...message, content };
}
