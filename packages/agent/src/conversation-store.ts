/**
 * The runtime's conversation store (ADR 0014): the pi-durable harness every
 * conversation lives in, whichever engine runs its turns. Each conversation
 * is one durable pi-durable conversation: its agent change (also the
 * stand-in a Claude plan conversation falls back onto), the documents the
 * Tool gate reads (permissions, YOLO), its entries (both engines write
 * theirs there, ADR 0018), and the reply tasks running in it. The engines
 * run turns over it; none of this belongs to one of them.
 */
import type { Context } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
  configure as configureAgent,
  type Conversation,
  type ConversationId,
  type Cursor,
  type EntryRecord,
  type Harness,
  type TaskGraphWatch,
} from "@earendil-works/pi-durable";
import { ConversationNotFoundError, type CompiledConversation } from "./engine";
import { applyPermissions, PermissionsDoc, YoloDoc } from "./policy";
import { attachmentsOf } from "./transcript";
import type { ConversationRef } from "./types";

const ctx: Context = BACKGROUND_CONTEXT;

/** Entries read per storage page when loading a chat's history. */
const HISTORY_PAGE = 500;

/** Task kinds that mean "the bot is replying" (background compaction does not). */
const REPLY_TASK_KINDS = new Set(["pi.generation", "pi.tool"]);

export interface ConversationStoreOptions {
  /** A conversation's reply tasks started or stopped running. */
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

  /** Start following the task graph (who is replying). Before `resume()`. */
  async start(): Promise<void> {
    const graph = await this.harness.watchTaskGraph(ctx);
    this.#graph = graph;
    this.#replying = replyingFromGraph(graph.value);
    graph.start(async (value) => {
      const next = replyingFromGraph(value);
      const changed: ConversationRef[] = [];
      for (const ref of next) if (!this.#replying.has(ref)) changed.push(ref);
      for (const ref of this.#replying) if (!next.has(ref)) changed.push(ref);
      this.#replying = next;
      for (const ref of changed) this.#onReplying(ref);
    });
  }

  /** Re-run the work a restart interrupted. Last at open: everything it runs against is set up. */
  resume(): void {
    this.harness.resume();
  }

  /**
   * Conversations with a reply task running in the harness. Only pi runs
   * turns as tasks; a Claude plan turn is not one.
   */
  replyingConversations(): ConversationRef[] {
    return [...this.#replying];
  }

  replying(ref: ConversationRef): boolean {
    return this.#replying.has(ref);
  }

  /** Create the durable conversation with its agent and permissions. */
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

  /**
   * Store the agent change and the gate's permissions, in one commit.
   * Applies from the next model request; history is kept.
   */
  async configure(ref: ConversationRef, compiled: CompiledConversation): Promise<void> {
    await this.conversation(ref);
    await this.harness.commit(async (tx) => {
      await configureAgent(tx, ref as ConversationId, compiled.change);
      if (compiled.permissions) {
        applyPermissions(await tx.doc(PermissionsDoc, ref as ConversationId), compiled.permissions);
      }
    }, ctx);
  }

  /** The conversation's YOLO document: on, and whose messages it trusts. */
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

  /** Upload ids attached to the newest 50 user entries (issue #17). */
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

  /** The conversation's durable record; throws `ConversationNotFoundError`. */
  async conversation(ref: ConversationRef): Promise<Conversation> {
    const conversation = await this.harness.conversation(ref as ConversationId, ctx);
    if (!conversation) throw new ConversationNotFoundError(ref);
    return conversation;
  }

  /** Stop following the task graph and close the harness (waits for running task code). */
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

/**
 * Every stored entry of a conversation, ascending — the full transcript, not
 * just what the model still sees after resets/compactions. Paged so a long
 * conversation never loads in one storage read. Both engines read their
 * entries through it.
 */
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
