/**
 * Tool calls waiting on the owner: an approval (`approvals.ts`) or an answer
 * to the bot's questions (`toolkits/questions.ts`).
 *
 * The call creates its task-scoped document, publishes details the chat
 * renders a card from, and waits on the document until the host writes the
 * owner's response. pi-durable 1.3 cannot park a task until an external
 * event, so the call stays running while it waits; after a restart it re-runs
 * (it is `replay: "safe"`), finds the same document and keeps waiting — or
 * acts on a response already recorded.
 *
 * Revisit once pi-durable ships an external wake/resume (`Harness.wake()`).
 */
import type { Context, JsonValue } from "@earendil-works/chord";
import type { JsonObject, TaskDocToken, ToolExecutionApi } from "@earendil-works/pi-durable";

/** In-memory index of calls waiting on the owner, per conversation (rebuilt as calls re-run after a restart). */
export class WaitTracker {
  readonly #pending = new Map<number, Set<number>>();
  readonly #listeners = new Set<(conversation: number, count: number) => void>();

  count(conversation: number): number {
    return this.#pending.get(conversation)?.size ?? 0;
  }

  conversations(): number[] {
    return [...this.#pending.keys()];
  }

  /** Task ids of the conversation's waiting calls. */
  tasks(conversation: number): number[] {
    return [...(this.#pending.get(conversation) ?? [])];
  }

  onChange(listener: (conversation: number, count: number) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  add(conversation: number, task: number): void {
    const set = this.#pending.get(conversation) ?? new Set();
    if (set.has(task)) return;
    set.add(task);
    this.#pending.set(conversation, set);
    this.#emit(conversation);
  }

  remove(conversation: number, task: number): void {
    const set = this.#pending.get(conversation);
    if (!set?.delete(task)) return;
    if (set.size === 0) this.#pending.delete(conversation);
    this.#emit(conversation);
  }

  #emit(conversation: number): void {
    const count = this.count(conversation);
    for (const listener of this.#listeners) {
      try {
        listener(conversation, count);
      } catch {
        // listeners must not break waiting calls
      }
    }
  }
}

/**
 * Wait until the call's `doc` leaves `pending`, counted by `tracker` and
 * showing `details` meanwhile. `init` runs on the document in the commit that
 * creates it (and again on every re-run, so it must be idempotent).
 */
export async function waitForOwner<T extends JsonObject & { status: string }>(
  api: ToolExecutionApi,
  tracker: WaitTracker,
  doc: TaskDocToken<T>,
  details: JsonValue,
  context: Context,
  init?: (value: T) => void,
): Promise<T> {
  const conversation = Number(api.conversationId);
  const task = Number(api.taskId);
  await api.commit(async (tx) => {
    // Creates the document; its draft is T made writable.
    const value = (await tx.doc(doc, api.taskId)) as T;
    init?.(value);
  }, context);
  const watch = await api.watchDoc(doc, api.taskId, context);
  if (!watch) throw new Error("owner response document missing");
  const settled = (value: T | null) => (value && value.status !== "pending" ? value : undefined);
  const already = settled(watch.value);
  if (already) {
    await watch.stop();
    return already;
  }
  tracker.add(conversation, task);
  try {
    await api.details(details, context);
    return await new Promise<T>((resolve, reject) => {
      watch.start(async (value) => {
        const response = settled(value);
        if (response) resolve(response);
      });
      void watch.closed.then((end) => reject(new Error(`owner wait ended: ${end.reason}`)));
    });
  } finally {
    tracker.remove(conversation, task);
    await watch.stop();
  }
}
