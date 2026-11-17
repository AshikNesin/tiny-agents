/**
 * The pi-durable harness as an engine (ADR 0008, ADR 0014): turns run as
 * pi-durable tasks, the transcript is the conversation's entries, and the
 * chat is their projection. The runtime's conversation store owns the
 * durable conversation (its agent change, documents and reply tasks); this
 * engine admits, stops and withdraws pi turns and reads their chat.
 */
import type { Context } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
  InboxDoc,
  LiveDoc,
  watchEvents,
  type Conversation,
  type ConversationId,
  type EntryRecord,
  type Extension,
  type Harness,
  type ToolRegistration,
} from "@earendil-works/pi-durable";
import { gateHooksOf } from "../approvals";
import { loadHistory, type ConversationStore } from "../conversation-store";
import type { AgentEngine, EngineSubmission } from "../engine";
import { toJson } from "../durable-json";
import type { ToolGate } from "../gate";
import type { GateUserMessage } from "../policy";
import { ChatProjection, unansweredOf, type ProjectionSnapshot } from "../projection";
import { REVIEW_ENTRY_LOOKBACK } from "../reviewer";
import { CHAT_USER_ENTRY, queuedOf, userMessagesOf } from "../transcript";
import type {
  ChatEvent,
  ChatState,
  ChatSubscription,
  ConversationRef,
  QueuedMessage,
  WithdrawOutcome,
} from "../types";

const ctx: Context = BACKGROUND_CONTEXT;

export class PiEngine implements AgentEngine {
  readonly kind = "pi" as const;
  readonly #store: ConversationStore;
  readonly #harness: Harness;
  readonly #chats = new Set<ChatSubscription>();

  /** Busy changes reach the runtime from the store: a pi reply is a task in its graph. */
  constructor(store: ConversationStore) {
    this.#store = store;
    this.#harness = store.harness;
  }

  /** Nothing to load: what pi runs on is the store's. */
  async start(): Promise<void> {}

  busy(ref: ConversationRef): boolean {
    return this.#store.replying(ref);
  }

  /** Every conversation has a pi transcript: pi runs whatever no other engine runs. */
  runs(): boolean {
    return true;
  }

  /** Nothing to take: pi runs on the agent change and permissions the store keeps. */
  async configure(): Promise<void> {}

  async submit(ref: ConversationRef, input: EngineSubmission): Promise<"accepted"> {
    const conversation = await this.#conversation(ref);
    const content = input.images?.length
      ? [
          ...(input.text ? [{ type: "text" as const, text: input.text }] : []),
          ...input.images.map((image) => ({
            type: "image" as const,
            data: image.data,
            mimeType: image.mimeType,
          })),
        ]
      : input.text;
    await conversation.submit(
      {
        type: "input",
        content,
        requestId: input.requestId,
        ...(input.whenBusy ? { whenBusy: input.whenBusy } : {}),
        // Every user message records its request id on the entry, so a
        // client can confirm its Echo by id instead of by text.
        entry: {
          kind: CHAT_USER_ENTRY,
          data: toJson({
            requestId: input.requestId,
            ...(input.peer ? { peer: input.peer } : {}),
            ...(input.author ? { author: { id: input.author.id, name: input.author.name } } : {}),
            ...(input.attachments?.length
              ? {
                  attachments: input.attachments.map((a) => ({
                    uploadId: a.uploadId,
                    kind: a.kind,
                    name: a.name,
                    mimeType: a.mimeType,
                    size: a.size,
                    ...(a.width !== undefined ? { width: a.width } : {}),
                    ...(a.height !== undefined ? { height: a.height } : {}),
                  })),
                }
              : {}),
          }),
        },
      },
      ctx,
    );
    return "accepted";
  }

  async abort(ref: ConversationRef): Promise<void> {
    const conversation = await this.#conversation(ref);
    await conversation.abort(ctx);
  }

  /**
   * Withdraw a message by its request id. A queued input leaves the inbox
   * (settling `unanswered`, reason `aborted`); a placed one is already part
   * of the running reply, and a settled one is done.
   */
  async withdraw(ref: ConversationRef, requestId: string): Promise<WithdrawOutcome> {
    const record = await this.#harness.commit(
      (tx) => tx.submissionByRequest(ref as ConversationId, requestId),
      ctx,
    );
    // Writes (compaction summaries) and unknown ids are not owner messages.
    if (!record || record.type !== "input") return "not_found";
    if (record.status === "queued") {
      const result = await this.#harness.abortSubmission(record.id, ctx, ref as ConversationId);
      if (result === "aborted") return "withdrawn";
      return result;
    }
    if (record.status === "placed") return "already_placed";
    // An input already withdrawn (by cancel or Stop) stays withdrawn, not 409.
    if (record.status === "unanswered" && record.reason === "aborted") return "withdrawn";
    return "settled";
  }

  /** The newest user messages (newest first) within the gate's lookback. */
  async userMessages(ref: ConversationRef): Promise<GateUserMessage[]> {
    const conversation = await this.#harness.conversation(ref as ConversationId, ctx);
    if (!conversation) return [];
    const page = await conversation.entries(
      { order: "descending" },
      REVIEW_ENTRY_LOOKBACK,
      undefined,
      ctx,
    );
    return userMessagesOf(page.items);
  }

  /**
   * An idle conversation is read from the store alone (no watch opened); a
   * busy one through a watch, so its in-flight reply and tool round show as
   * the stream would show them.
   */
  async read(ref: ConversationRef): Promise<ChatState> {
    const conversation = await this.#conversation(ref);
    if (this.busy(ref)) {
      const subscription = await this.watch(ref, () => undefined, {});
      await subscription.stop();
      return subscription.initial;
    }
    const projection = new ChatProjection(
      await this.#snapshot(conversation, ref, { entries: [], busy: false, tools: [] }),
    );
    return projection.state;
  }

  /**
   * The projection's event source. With `window`, the window's start stays
   * put, so new messages arrive as upserts and nothing drops out of it; a
   * re-snapshot (a slow client fell behind) re-windows to the newest ones.
   */
  async watch(
    ref: ConversationRef,
    listener: (events: ChatEvent[]) => void | Promise<void>,
    options: { window?: number },
  ): Promise<ChatSubscription> {
    const conversation = await this.#conversation(ref);
    const stream = await watchEvents(this.#harness, ref as ConversationId, ctx);
    const projection = new ChatProjection(
      await this.#snapshot(conversation, ref, stream.snapshot),
      options,
    );
    const initial = projection.state;
    let stopped = false;

    const subscription: ChatSubscription = {
      initial,
      stop: async () => {
        if (stopped) return;
        stopped = true;
        this.#chats.delete(subscription);
        await stream.stop();
      },
    };
    this.#chats.add(subscription);

    await listener([{ type: "snapshot", state: initial }]);

    stream.start(async (events) => {
      if (stopped) return;
      const outcome = projection.fold(events);
      if (outcome.resnapshot) {
        const fresh = events.findLast((event) => event.type === "snapshot");
        if (fresh && fresh.type === "snapshot") {
          projection.reset(await this.#snapshot(conversation, ref, fresh));
        }
      } else if (outcome.inboxChanged) {
        // The inbox doc moved (send while busy, placement, withdrawal); the
        // items' content lives in the doc, not the event.
        projection.setQueued(await this.#queued(ref));
      }
      const diff = projection.flush({ resnapshot: outcome.resnapshot });
      if (diff.length > 0) await listener(diff);
    });

    return subscription;
  }

  /** Stop the chat watches. The store stops the task graph and closes the harness. */
  async close(): Promise<void> {
    await Promise.allSettled([...this.#chats].map((chat) => chat.stop()));
  }

  /**
   * Everything a projection starts from: the full stored history (not just
   * what the model still sees), the stream's view of the in-flight reply
   * and tool round, the queue, and the unanswered reasons recorded on the
   * conversation's submissions (so they survive a reconnect and show in a
   * one-shot read, not only after a live `submission` event).
   */
  async #snapshot(
    conversation: Conversation,
    ref: ConversationRef,
    live: {
      entries: readonly EntryRecord[];
      generation?: { message?: ProjectionSnapshot["live"] };
      run?: unknown;
      busy?: boolean;
      tools: ProjectionSnapshot["tools"];
    },
  ): Promise<ProjectionSnapshot> {
    const entries = new Map<number, EntryRecord>();
    for (const entry of await loadHistory(conversation)) entries.set(Number(entry.id), entry);
    for (const entry of live.entries) entries.set(Number(entry.id), entry);
    const inspection = await this.#harness.inspect(ctx);
    const records = inspection.submissions.filter(
      (record) => Number(record.conversationId) === ref,
    );
    const inbox = await this.#harness.snapshot(InboxDoc, ref as ConversationId, ctx);
    const items = inbox?.items ?? [];
    return {
      entries: [...entries.values()],
      live: live.generation?.message,
      busy: live.busy ?? live.run !== undefined,
      tools: live.tools,
      queued:
        items.length === 0
          ? []
          : queuedOf(items, new Map(records.map((record) => [String(record.id), record]))),
      unanswered: unansweredOf(records),
    };
  }

  /**
   * The conversation's queued owner messages from `pi.inbox`. The inbox doc
   * holds the items; the submission records (via `inspect()`) supply the
   * request ids withdrawal addresses. Both reads are plain snapshots, newer
   * than any event that triggered the refresh.
   */
  async #queued(ref: ConversationRef): Promise<QueuedMessage[]> {
    const inbox = await this.#harness.snapshot(InboxDoc, ref as ConversationId, ctx);
    const items = inbox?.items ?? [];
    if (items.length === 0) return [];
    const inspection = await this.#harness.inspect(ctx);
    const records = new Map(
      inspection.submissions
        .filter((record) => Number(record.conversationId) === ref)
        .map((record) => [String(record.id), record]),
    );
    return queuedOf(items, records);
  }

  #conversation(ref: ConversationRef): Promise<Conversation> {
    return this.#store.conversation(ref);
  }
}

/**
 * pi's adapter onto the Tool gate: every tool of the extension runs through
 * it, with its answers kept in task documents (a restart re-attaches).
 * `userMessages` reads the conversation's newest user messages.
 */
export function gateExtension(
  extension: Extension,
  gate: ToolGate,
  userMessages: (conversation: number) => Promise<readonly GateUserMessage[]>,
): Extension {
  return {
    ...extension,
    tools: extension.tools?.map((tool) => gateTool(tool, gate, userMessages)),
  };
}

function gateTool(
  tool: ToolRegistration,
  gate: ToolGate,
  userMessages: (conversation: number) => Promise<readonly GateUserMessage[]>,
): ToolRegistration {
  const hooks = gateHooksOf(tool);
  return {
    ...tool,
    // The gate itself is replay-safe: its decisions are memoized, and an
    // unsafe tool's effect is guarded by its own memo.
    replay: "safe",
    execute: (args, api, context) =>
      gate.run(
        {
          name: tool.name,
          args,
          replaySafe: tool.replay === "safe",
          hooks,
          api,
          context,
          answers: "document",
          userMessages: () => userMessages(Number(api.conversationId)),
          // A run keeps its first input through every tool round (each
          // round is a new generation task), so that names the run.
          run: async () => {
            const live = await api.snapshot(LiveDoc, api.conversationId, context);
            const first = live?.run?.inputs[0];
            return first === undefined ? undefined : `${api.conversationId}:${first}`;
          },
          instructions: async () => (await api.agent(context)).instructions,
        },
        () => tool.execute(args, api, context),
      ),
  };
}
