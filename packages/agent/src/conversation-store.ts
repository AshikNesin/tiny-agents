import type { Context } from "@earendil-works/chord/context";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
  configure as configureAgent,
  type Conversation,
  type ConversationId,
  type Cursor,
  type EntryId,
  type EntryRecord,
  type Harness,
  type TaskGraphWatch,
  UsageDoc,
} from "@earendil-works/pi-durable";
import { ConversationNotFoundError, type CompiledConversation } from "./engine";
import { applyPermissions, PermissionsDoc, usedTokens, YoloDoc } from "./policy";
import { traceOf, usageTotalsOf, type ConversationTrace, type ConversationUsage } from "./trace";
import { attachmentsOf } from "./transcript";
import type { ConversationRef } from "./types";

const ctx: Context = BACKGROUND_CONTEXT;

const HISTORY_PAGE = 500;

const REPLY_TASK_KINDS = new Set(["pi.generation", "pi.tool"]);

export interface ConversationStoreOptions {
  onReplying?: (ref: ConversationRef) => void;
}

export class ConversationStore {
  readonly harness: Harness;
  readonly #onReplying: (ref: ConversationRef) => void;
  #replying = new Set<ConversationRef>();
  #graph: TaskGraphWatch | undefined;

  constructor(harness: Harness, options: ConversationStoreOptions = {}) {
    this.harness = harness;
    this.#onReplying = options.onReplying ?? (() => undefined);
  }

  async start(): Promise<void> {
    const graph = await this.harness.watchTaskGraph(ctx);
    this.#graph = graph;
    this.#replying = replyingFromGraph(graph.value);
    graph.start(async (call) => {
      if (call.kind !== "value") return;
      const next = replyingFromGraph(call.value);
      const changed: ConversationRef[] = [];
      for (const ref of next) if (!this.#replying.has(ref)) changed.push(ref);
      for (const ref of this.#replying) if (!next.has(ref)) changed.push(ref);
      this.#replying = next;
      for (const ref of changed) this.#onReplying(ref);
    });
  }

  resume(): void {
    this.harness.resume();
  }

  replyingConversations(): ConversationRef[] {
    return [...this.#replying];
  }

  replying(ref: ConversationRef): boolean {
    return this.#replying.has(ref);
  }

  async create(compiled: CompiledConversation): Promise<ConversationRef> {
    const conversation = await this.harness.createConversation(
      { ownership: { kind: "ownerless" }, agent: compiled.change },
      ctx,
    );
    const ref = Number(conversation.id);
    const { permissions } = compiled;
    if (permissions) {
      await this.harness.commit(async (tx) => {
        applyPermissions(await tx.doc(PermissionsDoc, ref as ConversationId), permissions);
      }, ctx);
    }
    return ref;
  }

  async configure(ref: ConversationRef, compiled: CompiledConversation): Promise<void> {
    await this.conversation(ref);
    await this.harness.commit(async (tx) => {
      await configureAgent(tx, ref as ConversationId, compiled.change);
      if (compiled.permissions) {
        applyPermissions(await tx.doc(PermissionsDoc, ref as ConversationId), compiled.permissions);
      }
    }, ctx);
  }

  async fork(ref: ConversationRef, at: number): Promise<ConversationRef> {
    const conversation = await this.conversation(ref);
    const forked = await conversation.fork(
      at as EntryId,
      { ownership: { kind: "ownerless" } },
      ctx,
    );
    return Number(forked.id);
  }

  async compact(ref: ConversationRef, instructions?: string): Promise<void> {
    const conversation = await this.conversation(ref);
    await conversation.compact(instructions, ctx);
  }

  async continueReply(ref: ConversationRef): Promise<void> {
    const conversation = await this.conversation(ref);
    await conversation.submit({ type: "continue" }, ctx);
  }

  async usedTokens(ref: ConversationRef): Promise<number> {
    await this.conversation(ref);
    return this.harness.commit(
      async (tx) => usedTokens(await tx.doc(UsageDoc, ref as ConversationId)),
      ctx,
    );
  }

  async usage(ref: ConversationRef): Promise<ConversationUsage> {
    await this.conversation(ref);
    return this.harness.commit(
      async (tx) => usageTotalsOf(await tx.doc(UsageDoc, ref as ConversationId)),
      ctx,
    );
  }

  async trace(ref: ConversationRef): Promise<ConversationTrace> {
    const conversation = await this.conversation(ref);
    const entries = await loadHistory(conversation);
    return traceOf(entries, await this.usage(ref));
  }

  async yolo(ref: ConversationRef): Promise<{ on: boolean; by?: number }> {
    await this.conversation(ref);
    return this.harness.commit(async (tx) => {
      const doc = await tx.doc(YoloDoc, ref as ConversationId);
      return doc.on ? { on: true, ...(doc.by !== undefined ? { by: doc.by } : {}) } : { on: false };
    }, ctx);
  }

  async setYolo(ref: ConversationRef, on: boolean, by?: number): Promise<void> {
    await this.conversation(ref);
    await this.harness.commit(async (tx) => {
      const doc = await tx.doc(YoloDoc, ref as ConversationId);
      doc.on = on;
      if (on) {
        doc.since = Date.now();
        if (by !== undefined) doc.by = by;
        else delete doc.by;
      } else {
        delete doc.since;
        delete doc.by;
      }
    }, ctx);
  }

  async attachmentIds(ref: ConversationRef): Promise<string[]> {
    const conversation = await this.conversation(ref);
    const page = await conversation.entries({ order: "descending" }, 50, undefined, ctx);
    const ids: string[] = [];
    for (const entry of page.items) {
      for (const attachment of attachmentsOf(entry) ?? []) {
        if (!ids.includes(attachment.uploadId)) ids.push(attachment.uploadId);
      }
    }
    return ids;
  }

  async conversation(ref: ConversationRef): Promise<Conversation> {
    const conversation = await this.harness.conversation(ref as ConversationId, ctx);
    if (!conversation) throw new ConversationNotFoundError(ref);
    return conversation;
  }

  async close(): Promise<void> {
    await this.#graph?.stop().catch(() => undefined);
    await this.harness.close(ctx);
  }
}

function replyingFromGraph(value: TaskGraphWatch["value"]): Set<ConversationRef> {
  const replying = new Set<ConversationRef>();
  for (const node of Object.values(value.tasks)) {
    if (REPLY_TASK_KINDS.has(node.kind)) replying.add(Number(node.conversationId));
  }
  return replying;
}

export async function loadHistory(conversation: Conversation): Promise<EntryRecord[]> {
  const entries: EntryRecord[] = [];
  let cursor: Cursor | undefined;
  do {
    const page = await conversation.entries({ order: "ascending" }, HISTORY_PAGE, cursor, ctx);
    entries.push(...page.items);
    cursor = page.next;
  } while (cursor !== undefined);
  return entries;
}
