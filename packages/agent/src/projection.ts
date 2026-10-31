/**
 * The chat projection: a conversation's durable events folded into the chat
 * state the owner sees, and the minimal events that carry each change to a
 * client. Pure over its inputs: the runtime feeds it a snapshot (every
 * stored entry, the in-flight reply, the current tool round, the queue and
 * the recorded unanswered reasons) and then each batch of pi-durable events;
 * tests feed it recorded sequences. The window (issue #92) lives here too:
 * its start stays put once older messages exist, so new messages extend it,
 * and a re-snapshot re-windows to the newest ones.
 */
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type {
  AgentEvent,
  EntryRecord,
  MessageChange,
  SubmissionRecord,
  ToolSlot,
} from "@earendil-works/pi-durable";
import { chatState, diffChat, windowChat, type LiveTool, type RawChat } from "./transcript";
import type { ChatEvent, ChatState, QueuedMessage } from "./types";

/** Everything a projection starts from (or starts over from on a re-snapshot). */
export interface ProjectionSnapshot {
  /** Every stored entry of the conversation, any order. */
  entries: readonly EntryRecord[];
  /** The reply being generated, if any. */
  live?: AssistantMessage;
  busy: boolean;
  /** Tool calls of the current round. */
  tools: readonly ToolSlot[];
  queued?: readonly QueuedMessage[];
  /** Failure reasons of inputs that settled without an answer, by user entry id. */
  unanswered?: ReadonlyMap<number, string>;
}

/** What a batch of events asked of the runtime before the next flush. */
export interface FoldOutcome {
  /** A pi-durable snapshot arrived: the caller must `reset` from fresh history. */
  resnapshot: boolean;
  /** The inbox moved: the caller should `setQueued` from the inbox document. */
  inboxChanged: boolean;
}

/** Unanswered reasons recorded on the conversation's submissions, by user entry id. */
export function unansweredOf(records: Iterable<SubmissionRecord>): Map<number, string> {
  const out = new Map<number, string>();
  for (const record of records) {
    if (record.type === "input" && record.status === "unanswered" && record.entry !== undefined) {
      out.set(Number(record.entry), record.reason);
    }
  }
  return out;
}

/** Model-issued calls of the current round (nested calls live in `nestedTools`). */
export function liveTools(slots: readonly ToolSlot[]): Map<string, LiveTool> {
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
  /** The window's first message id, fixed once older messages exist. */
  #from: string | undefined;
  /** The state last handed out (what the next flush diffs against). */
  #shown: ChatState;

  constructor(snapshot: ProjectionSnapshot, options: { window?: number } = {}) {
    this.#window = options.window;
    this.#load(snapshot);
    this.#shown = this.#windowed(true)!;
  }

  /** The state as this projection shows it (windowed when a window was asked for). */
  get state(): ChatState {
    return this.#shown;
  }

  /** The whole transcript, unwindowed. */
  full(): ChatState {
    return chatState(this.#raw());
  }

  /** Start over from a fresh snapshot (a pi-durable re-snapshot). The next flush re-windows. */
  reset(snapshot: ProjectionSnapshot): void {
    this.#entries.clear();
    this.#unanswered.clear();
    this.#load(snapshot);
    this.#from = undefined;
  }

  setQueued(queued: readonly QueuedMessage[]): void {
    this.#queued = queued;
  }

  /**
   * Fold a batch of events. A `snapshot` event is not folded: it means the
   * stream restarted, and the caller must `reset` from fresh history before
   * flushing (its other events are still applied, in order).
   */
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

  /** Fold one event. */
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

  /**
   * The events that turn the state last shown into the current one: a
   * `snapshot` after a reset, or when the window's start vanished (never
   * expected), else the minimal diff. Empty when nothing changed.
   */
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

  /** `full` as this projection shows it; undefined when the window's start is gone. */
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

/** One streaming change applied to the in-flight assistant message. */
export function applyChange(message: AssistantMessage, change: MessageChange): AssistantMessage {
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
