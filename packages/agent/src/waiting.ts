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

export function refuseUnattended(message: string): ToolExecutionResult {
  return {
    output: [{ type: "text", text: message }],
    isError: true,
    details: { approval: "refused" },
  };
}

export async function unattendedOnce(
  api: ToolExecutionApi,
  context: Context,
  memoKey = "gate:unattended",
): Promise<boolean> {
  return api.memo(memoKey, await isUnattendedConversation(api, context), context);
}

export type HostTx = Parameters<Parameters<Harness["commit"]>[0]>[0];

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

export function sealedAsNotPending(error: unknown, notPending: () => Error): never {
  if (error instanceof Error && /terminal/i.test(error.message)) throw notPending();
  throw error;
}

export interface WaitInfo {
  tool?: string;
  preview?: string;
  subject?: string;
  expiresAt?: number;
  vault?: { grantable: boolean };
}

export interface WaitTransition extends WaitInfo {
  change: "added" | "removed";
  conversation: number;
  task: number;
}

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

  tasks(conversation: number): number[] {
    return [...(this.#pending.get(conversation) ?? [])];
  }

  onChange(listener: (conversation: number, count: number) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

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
      } catch {}
    }
    for (const listener of this.#transitionListeners) {
      try {
        listener(transition);
      } catch {}
    }
  }
}

export async function waitForOwner<T extends JsonObject & { status: string }>(
  api: ToolExecutionApi,
  tracker: WaitTracker,
  doc: TaskDocToken<T>,
  details: JsonValue | ((value: T) => JsonValue),
  context: Context,
  init?: (value: T) => void,
  info?: WaitInfo,
): Promise<T> {
  const conversation = Number(api.conversationId);
  const task = Number(api.taskId);
  await api.commit(async (tx) => {
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
