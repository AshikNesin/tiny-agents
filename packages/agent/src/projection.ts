import type { AssistantMessage } from "@earendil-works/pi-ai";
import type {
  EntryRecord,
  LiveState,
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
      status: slot.status === "pending" || slot.status === "done" ? slot.status : "running",
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

  setQueued(queued: readonly QueuedMessage[]): void {
    this.#queued = queued;
  }

  observe(entries: readonly EntryRecord[], live: LiveState | undefined): void {
    for (const entry of entries) this.#entries.set(Number(entry.id), entry);
    const message = live?.generation?.message as AssistantMessage | undefined;
    this.#live = message ? structuredClone(message) : undefined;
    this.#busy = live?.run !== undefined;
    this.#tools = liveTools(live?.tools ?? []);
  }

  markUnanswered(unanswered: ReadonlyMap<number, string>): void {
    for (const [entry, reason] of unanswered) this.#unanswered.set(entry, reason);
  }

  flush(): ChatEvent[] {
    const kept = this.#windowed(false);
    const next = kept ?? this.#windowed(true)!;
    const events = !kept
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
