/**
 * Tool approvals (issue #1 D3/D4).
 *
 * Every capability tool is installed through `gateExtension`, which wraps it
 * in a replay-safe gate:
 *
 * - A conversation's `tiny.permissions` document lists the tools that run
 *   without asking (written by `AgentRuntime.configure`). A conversation
 *   without the document predates permissions and runs everything.
 * - A tool that must ask creates its task-scoped `tiny.approval` document,
 *   publishes `{ approval: "pending" }` details (the chat renders the card from
 *   them) and waits on the document until the host writes a decision
 *   (`AgentRuntime.decideApproval`). pi-durable 1.3 cannot park a task until an
 *   external event, so the call stays running while it waits; after a restart
 *   the gate re-runs (it is `replay: "safe"`), finds the same document and keeps
 *   waiting — or acts on a decision already recorded.
 * - The side effect itself keeps the wrapped tool's replay policy: for a tool
 *   that is not replay-safe, a durable memo records that the effect started, so
 *   a crash during it reports "interrupted" instead of running it twice.
 *
 * Revisit once pi-durable ships an external wake/resume (`Harness.wake()`).
 */
import type { Context } from "@earendil-works/chord";
import {
  defineDoc,
  type Extension,
  type ToolExecutionApi,
  type ToolExecutionResult,
  type ToolRegistration,
} from "@earendil-works/pi-durable";

/** Which tools of the conversation run without asking. */
export const PermissionsDoc = defineDoc<{ allow: string[] }>({
  kind: "tiny.permissions",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "current",
  initial: () => ({ allow: [] }),
});

export type ApprovalDecision = "approved" | "denied";

/** One gated tool call's approval, owned by its tool task. */
export const ApprovalDoc = defineDoc<{ status: "pending" | ApprovalDecision }>({
  kind: "tiny.approval",
  version: 1,
  scope: "task",
  initial: () => ({ status: "pending" }),
});

/** In-memory index of calls waiting for approval, per conversation (rebuilt as gates re-run after a restart). */
export class ApprovalTracker {
  readonly #pending = new Map<number, Set<number>>();
  readonly #listeners = new Set<(conversation: number, count: number) => void>();

  count(conversation: number): number {
    return this.#pending.get(conversation)?.size ?? 0;
  }

  conversations(): number[] {
    return [...this.#pending.keys()];
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
        // listeners must not break gates
      }
    }
  }
}

const text = (value: string) => [{ type: "text" as const, text: value }];

/** Wrap every tool of an extension in the approval gate. */
export function gateExtension(extension: Extension, tracker: ApprovalTracker): Extension {
  return { ...extension, tools: extension.tools?.map((tool) => gateTool(tool, tracker)) };
}

export function gateTool(tool: ToolRegistration, tracker: ApprovalTracker): ToolRegistration {
  return {
    ...tool,
    replay: "safe",
    async execute(args, api, context): Promise<ToolExecutionResult> {
      // Decided once per call, so a permission change mid-call can't flip it on replay.
      const ask = await api.memo("gate:ask", await mustAsk(tool.name, api, context), context);
      if (ask) {
        const decision = await waitForDecision(api, tracker, context);
        if (decision === "denied") {
          return {
            output: text(`The owner denied this ${tool.name} call. Do not retry it unless asked.`),
            isError: true,
            details: { approval: "denied" },
          };
        }
      }
      if (tool.replay !== "safe") {
        if (await api.memo<boolean>("gate:effect", context)) {
          return {
            output: text(
              `Tool ${tool.name} was interrupted by a restart and may have partially run.`,
            ),
            isError: true,
            details: { interrupted: true, ...(ask ? { approval: "approved" } : {}) },
          };
        }
        await api.memo("gate:effect", true, context);
      }
      const result = await tool.execute(args, api, context);
      // The pending card's details must not outlive the decision.
      return ask
        ? { ...result, details: { approval: "approved", result: result.details ?? null } }
        : result;
    },
  };
}

async function mustAsk(name: string, api: ToolExecutionApi, context: Context): Promise<boolean> {
  const permissions = await api.snapshot(PermissionsDoc, api.conversationId, context);
  return permissions !== undefined && !permissions.allow.includes(name);
}

async function waitForDecision(
  api: ToolExecutionApi,
  tracker: ApprovalTracker,
  context: Context,
): Promise<ApprovalDecision> {
  const conversation = Number(api.conversationId);
  const task = Number(api.taskId);
  await api.commit(async (tx) => {
    await tx.doc(ApprovalDoc, api.taskId);
  }, context);
  const watch = await api.watchDoc(ApprovalDoc, api.taskId, context);
  if (!watch) throw new Error("approval document missing");
  const decided = (value: { status: string } | null) =>
    value && value.status !== "pending" ? (value.status as ApprovalDecision) : undefined;
  const already = decided(watch.value);
  if (already) {
    await watch.stop();
    return already;
  }
  tracker.add(conversation, task);
  try {
    await api.details({ approval: "pending" }, context);
    return await new Promise<ApprovalDecision>((resolve, reject) => {
      watch.start(async (value) => {
        const decision = decided(value);
        if (decision) resolve(decision);
      });
      void watch.closed.then((end) => reject(new Error(`approval wait ended: ${end.reason}`)));
    });
  } finally {
    tracker.remove(conversation, task);
    await watch.stop();
  }
}
