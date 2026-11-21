import type { Context } from "@earendil-works/chord/context";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
  InboxDoc,
  LiveDoc,
  type Conversation,
  type ConversationView,
  type ConversationId,
  type EntryRecord,
  type Extension,
  type Harness,
  type LiveState,
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

  constructor(store: ConversationStore) {
    this.#store = store;
    this.#harness = store.harness;
  }

  async start(): Promise<void> {}

  busy(ref: ConversationRef): boolean {
    return this.#store.replying(ref);
  }

  runs(): boolean {
    return true;
  }

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
        ...(input.peer ? { onAbort: "keep" as const } : {}),
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

  async withdraw(ref: ConversationRef, requestId: string): Promise<WithdrawOutcome> {
    const record = await this.#harness.commit(
      (tx) => tx.submissionByRequest(ref as ConversationId, requestId),
      ctx,
    );
    if (!record || record.type !== "input") return "not_found";
    if (record.status === "queued") {
      const result = await this.#harness.abortSubmission(record.id, ctx, ref as ConversationId);
      if (result === "aborted") return "withdrawn";
      return result;
    }
    if (record.status === "placed") return "already_placed";
    if (record.status === "unanswered" && record.reason === "aborted") return "withdrawn";
    return "settled";
  }

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

  async watch(
    ref: ConversationRef,
    listener: (events: ChatEvent[]) => void | Promise<void>,
    options: { window?: number },
  ): Promise<ChatSubscription> {
    const conversation = await this.#conversation(ref);
    const watch = await conversation.watch(ctx);
    const first = liveOf(watch.value);
    const projection = new ChatProjection(
      await this.#snapshot(conversation, ref, {
        entries: watch.value.entries,
        generation: first?.generation,
        run: first?.run,
        tools: first?.tools ?? [],
      }),
      options,
    );
    const initial = projection.state;
    let stopped = false;
    let inbox = docKey(watch.value, "pi.inbox");
    let failure = JSON.stringify(first?.runFailure ?? null);

    const subscription: ChatSubscription = {
      initial,
      stop: async () => {
        if (stopped) return;
        stopped = true;
        this.#chats.delete(subscription);
        await watch.stop();
      },
    };
    this.#chats.add(subscription);

    await listener([{ type: "snapshot", state: initial }]);

    watch.start(async (call) => {
      if (stopped || call.kind !== "value") return;
      const live = liveOf(call.value);
      projection.observe(call.value.entries, live);
      const nextInbox = docKey(call.value, "pi.inbox");
      if (nextInbox !== inbox) {
        inbox = nextInbox;
        projection.setQueued(await this.#queued(ref));
      }
      const nextFailure = JSON.stringify(live?.runFailure ?? null);
      if (nextFailure !== failure) {
        failure = nextFailure;
        if (live?.runFailure) projection.markUnanswered(await this.#unanswered(ref));
      }
      const diff = projection.flush();
      if (diff.length > 0) await listener(diff);
    });

    return subscription;
  }

  async close(): Promise<void> {
    await Promise.allSettled([...this.#chats].map((chat) => chat.stop()));
  }

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

  async #unanswered(ref: ConversationRef): Promise<Map<number, string>> {
    const inspection = await this.#harness.inspect(ctx);
    return unansweredOf(
      inspection.submissions.filter((record) => Number(record.conversationId) === ref),
    );
  }

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

function liveOf(view: ConversationView): LiveState | undefined {
  return view.docs["pi.live"] as LiveState | undefined;
}

function docKey(view: ConversationView, kind: string): string {
  return JSON.stringify(view.docs[kind] ?? null);
}

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
          run: async () => {
            const live = await api.snapshot(LiveDoc, api.conversationId, context);
            const first = live?.run?.inputs[0];
            return first === undefined ? undefined : `${api.conversationId}:${first}`;
          },
          instructions: async () => (await api.agent(context)).instructions,
        },
        (inner) => tool.execute(args, inner, context),
      ),
    cancel: async (args, api, context) => {
      gate.release(api);
      await tool.cancel?.(args, api, context);
    },
  };
}
