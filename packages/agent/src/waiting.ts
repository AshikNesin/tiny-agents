import type { Context } from "@earendil-works/chord/context";
import type { JsonValue } from "@earendil-works/chord/json";
import {
  defineDoc,
  defineSignal,
  type Harness,
  type JsonObject,
  type TaskDocToken,
  type TaskId,
  type ToolExecutionApi,
  type ToolExecutionResult,
  type ToolPark,
} from "@earendil-works/pi-durable";
import { Type } from "typebox";
import { z } from "zod";
import { parseStored, toJson } from "./durable-json";
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
  constructor(readonly channel: WaitChannel = "approval") {}

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

const OwnerAnswered = defineSignal({
  name: "tiny.owner-answered",
  version: 1,
  schema: Type.Object({}),
});

const ANSWER = "answer";

export async function wakeOwnerWait(tx: Pick<HostTx, "signal">, id: TaskId): Promise<void> {
  await tx.signal(id, OwnerAnswered, ANSWER, {});
}

export type WaitChannel = "approval" | "question";

const WaitDoc = defineDoc<{ channel: WaitChannel | null; info: JsonValue }>({
  kind: "tiny.wait",
  version: 1,
  scope: "task",
  initial: () => ({ channel: null, info: null }),
  checkpointWhen: () => false,
});

const waitInfo: z.ZodType<WaitInfo> = z.object({
  tool: z.string().optional(),
  preview: z.string().optional(),
  subject: z.string().optional(),
  expiresAt: z.number().optional(),
  vault: z.object({ grantable: z.boolean() }).optional(),
});

export async function restoreParkedWaits(
  harness: Pick<Harness, "inspect" | "snapshot">,
  trackers: readonly WaitTracker[],
  context: Context,
): Promise<void> {
  const inspection = await harness.inspect(context);
  for (const { record, state } of inspection.tasks) {
    if (record.kind !== "pi.tool" || state.kind !== "sleeping") continue;
    const wait = await harness.snapshot(WaitDoc, record.id, context);
    const tracker = trackers.find((candidate) => candidate.channel === wait?.channel);
    if (!wait || !tracker) continue;
    let info: WaitInfo = {};
    try {
      info = parseStored("tiny.wait.info", wait.info ?? {}, waitInfo);
    } catch {}
    tracker.add(Number(record.conversationId), Number(record.id), info);
  }
}

export async function parkForOwner<T extends JsonObject & { status: string }>(
  api: ToolExecutionApi,
  tracker: WaitTracker,
  doc: TaskDocToken<T>,
  details: JsonValue | ((value: T) => JsonValue),
  context: Context,
  init?: (value: T) => void,
  info?: WaitInfo,
): Promise<T | ToolPark> {
  const conversation = Number(api.conversationId);
  const task = Number(api.taskId);
  await api.commit(async (tx) => {
    const current = (await tx.doc(doc, api.taskId)) as T;
    init?.(current);
    const deadline = deadlineOf(current);
    if (current.status !== "pending") return;
    if (deadline !== undefined && deadline <= Date.now()) {
      (current as { status: string }).status = "expired";
      return;
    }
    const wait = await tx.doc(WaitDoc, api.taskId);
    wait.channel = tracker.channel;
    wait.info = toJson({ ...info, ...(deadline !== undefined ? { expiresAt: deadline } : {}) });
  }, context);
  const value = (await api.snapshot(doc, api.taskId, context)) as T;
  if (value.status !== "pending") {
    tracker.remove(conversation, task);
    return value;
  }
  const deadline = deadlineOf(value);
  await api.details(typeof details === "function" ? details(value) : details, context);
  tracker.add(conversation, task, {
    ...info,
    ...(deadline !== undefined ? { expiresAt: deadline } : {}),
  });
  return {
    sleep: {
      signals: [OwnerAnswered.key(ANSWER)],
      ...(deadline !== undefined ? { until: deadline } : {}),
    },
  };
}

function deadlineOf(value: object): number | undefined {
  const expiresAt = (value as { expiresAt?: unknown }).expiresAt;
  return typeof expiresAt === "number" && expiresAt > 0 ? expiresAt : undefined;
}

export function isParked<T extends object>(value: T | ToolPark): value is ToolPark {
  return "sleep" in value || "wait" in value;
}
