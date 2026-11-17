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
import type {
  Harness,
  JsonObject,
  TaskDocToken,
  TaskId,
  ToolExecutionApi,
  ToolExecutionResult,
} from "@earendil-works/pi-durable";
import { isUnattendedConversation } from "./policy";

/**
 * A call that would wait on the owner in a conversation nobody watches (a
 * routine's, issue #63) is refused instead, every wait kind alike: the
 * model gets `message`, and `approval: "refused"` lets a Routine run see
 * that the Turn was blocked for want of the owner (`finishedReplyTo`).
 */
export function refuseUnattended(message: string): ToolExecutionResult {
  return {
    output: [{ type: "text", text: message }],
    isError: true,
    details: { approval: "refused" },
  };
}

/** Whether nobody watches the conversation, decided once per call (a replay keeps the answer). */
export async function unattendedOnce(
  api: ToolExecutionApi,
  context: Context,
  memoKey = "gate:unattended",
): Promise<boolean> {
  return api.memo(memoKey, await isUnattendedConversation(api, context), context);
}

/** The transaction a host-side answer runs in (pi-durable's commit callback argument). */
export type HostTx = Parameters<Parameters<Harness["commit"]>[0]>[0];

/**
 * The running tool task a host answer addresses: it must exist, be a tool
 * call, still be running, and (when `conversation` is given) belong to that
 * conversation. Throws `notPending()` otherwise. Returns the conversation.
 */
export async function pendingToolTask(
  tx: Pick<HostTx, "task">,
  id: TaskId,
  conversation: number | undefined,
  notPending: () => Error,
): Promise<number> {
  const task = await tx.task(id);
  if (
    !task ||
    (conversation !== undefined && Number(task.conversationId) !== conversation) ||
    task.kind !== "pi.tool" ||
    task.state.status === "terminal" ||
    task.state.status === "completing"
  ) {
    throw notPending();
  }
  return Number(task.conversationId);
}

/**
 * A terminal task's documents are sealed: writing one throws, which means
 * the call ended meanwhile. Every host answer maps that to its own
 * not-pending error; anything else is rethrown.
 */
export function sealedAsNotPending(error: unknown, notPending: () => Error): never {
  if (error instanceof Error && /terminal/i.test(error.message)) throw notPending();
  throw error;
}

/** What a waiting call is about, for listeners that tell the owner (notifications). */
export interface WaitInfo {
  /** The tool that waits (the gated tool, or `ask_owner`). */
  tool?: string;
  /** Short owner-facing text, e.g. the first question asked. Untrusted model text. */
  preview?: string;
  /** What the call wants to use or open, e.g. "GitHub login on github.com" (vault calls). */
  subject?: string;
  /** Epoch ms after which the wait settles as expired (set from the document). */
  expiresAt?: number;
  /** A vault use waits: whether its card offers "For this chat" (approvals only). */
  vault?: { grantable: boolean };
}

/** One call starting or stopping to wait on the owner. */
export interface WaitTransition extends WaitInfo {
  change: "added" | "removed";
  conversation: number;
  task: number;
}

/** In-memory index of calls waiting on the owner, per conversation (rebuilt as calls re-run after a restart). */
export class WaitTracker {
  readonly #pending = new Map<number, Set<number>>();
  readonly #listeners = new Set<(conversation: number, count: number) => void>();
  readonly #transitionListeners = new Set<(transition: WaitTransition) => void>();

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

  /**
   * Each call that starts or stops waiting. A call re-run after a restart is
   * added again, so listeners that act once per call must dedupe by task.
   */
  onTransition(listener: (transition: WaitTransition) => void): () => void {
    this.#transitionListeners.add(listener);
    return () => this.#transitionListeners.delete(listener);
  }

  add(conversation: number, task: number, info: WaitInfo = {}): void {
    const set = this.#pending.get(conversation) ?? new Set();
    if (set.has(task)) return;
    set.add(task);
    this.#pending.set(conversation, set);
    this.#emit(conversation, { change: "added", conversation, task, ...info });
  }

  remove(conversation: number, task: number): void {
    const set = this.#pending.get(conversation);
    if (!set?.delete(task)) return;
    if (set.size === 0) this.#pending.delete(conversation);
    this.#emit(conversation, { change: "removed", conversation, task });
  }

  #emit(conversation: number, transition: WaitTransition): void {
    const count = this.count(conversation);
    for (const listener of this.#listeners) {
      try {
        listener(conversation, count);
      } catch {
        // listeners must not break waiting calls
      }
    }
    for (const listener of this.#transitionListeners) {
      try {
        listener(transition);
      } catch {
        // listeners must not break waiting calls
      }
    }
  }
}

/**
 * Wait until the call's `doc` leaves `pending`, counted by `tracker` and
 * showing `details` meanwhile. `init` runs on the document in the commit that
 * creates it (and again on every re-run, so it must be idempotent). A
 * document whose `expiresAt` (epoch ms) passes while pending settles as
 * `expired`, also when the deadline passed during a restart. `info` tells
 * the tracker's listeners what the call waits for.
 */
export async function waitForOwner<T extends JsonObject & { status: string }>(
  api: ToolExecutionApi,
  tracker: WaitTracker,
  doc: TaskDocToken<T>,
  /** Or derived from the document (e.g. to show its deadline). */
  details: JsonValue | ((value: T) => JsonValue),
  context: Context,
  init?: (value: T) => void,
  info?: WaitInfo,
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
  const expiresAt = (watch.value as { expiresAt?: unknown } | null)?.expiresAt;
  const expire = async () => {
    await api.commit(async (tx) => {
      const value = (await tx.doc(doc, api.taskId)) as T;
      if (value.status === "pending") (value as { status: string }).status = "expired";
    }, context);
  };
  if (typeof expiresAt === "number" && expiresAt <= Date.now()) {
    await watch.stop();
    await expire();
    const value = await api.snapshot(doc, api.taskId, context);
    return value as T;
  }
  tracker.add(conversation, task, {
    ...info,
    ...(typeof expiresAt === "number" ? { expiresAt } : {}),
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await api.details(typeof details === "function" ? details(watch.value as T) : details, context);
    return await new Promise<T>((resolve, reject) => {
      watch.start(async (value) => {
        const response = settled(value);
        if (response) resolve(response);
      });
      void watch.closed.then((end) => reject(new Error(`owner wait ended: ${end.reason}`)));
      if (typeof expiresAt === "number") {
        timer = setTimeout(() => void expire().catch(reject), expiresAt - Date.now());
        timer.unref?.();
      }
    });
  } finally {
    clearTimeout(timer);
    tracker.remove(conversation, task);
    await watch.stop();
  }
}
