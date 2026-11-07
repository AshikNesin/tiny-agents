/**
 * A conversation settled (GLOSSARY: Settled): its reply finished and it went
 * idle. `startSettledPipeline` is the one listener for that: it builds every
 * step from the opened runtime and runs them in one fixed order, off one
 * subscription to the activity feed, with one shared read of the transcript
 * and one shared lookup of who is behind the conversation (each taken
 * lazily, only by a step that needs it):
 *
 *   1. answer the Deliveries submitted to it (bots.delivery.ts)
 *   2. resolve the routine runs awaiting it (routines.runs.ts)
 *   3. fold its last reply into the bot list (bots.list.ts)
 *   4. push a failed or long reply to the owner (notifications.wiring.ts)
 *   5. arm memory capture (memories.capture.ts), when there is a side-caller
 *
 * Before the steps, the sender's per-turn budget (bots.messaging.ts) resets.
 * Each step is best-effort: a failure is logged and the next step still
 * runs; the conversation's next idle, or the step's boot sweep, retries. A
 * step's sweep runs once, after the pipeline subscribed, so nothing that
 * settles meanwhile is missed. The pipeline remembers when each
 * conversation went busy, so a step can tell how long the reply ran.
 */
import { logger } from "@groot/core/logger";
import type { AgentRuntime, ChatState } from "@tiny-agents/agent";
import { conversationOwner, type ConversationOwner } from "./bots.owner";
import { createDeliveries } from "./bots.delivery";
import { botListStep } from "./bots.list";
import { turnBudgetOf } from "./bots.messaging";
import { createMemoryCapture } from "./memories.capture";
import { captureConversation } from "./memories.runner";
import type { SideCaller } from "./side-call";
import { routineRunsStep } from "../routines/routines.watcher";
import { runNotificationsStep, type Notifier } from "../notifications/notifications.wiring";

/** The conversation's chat state, read once by whoever reacts to it settling. */
export type ChatRead = () => Promise<ChatState>;

interface SettledConversation {
  conversationId: number;
  /** Its chat state, read on first call and shared by every later step. */
  chat: ChatRead;
  /** Who is behind it (a bot's chat, a routine's), looked up on first call and shared. */
  owner: () => Promise<ConversationOwner | undefined>;
  /** Epoch ms when the reply started (the busy flip); unknown for one that was running at boot. */
  startedAt?: number;
}

export interface SettledStep {
  /** For logs. */
  name: string;
  run(settled: SettledConversation): Promise<unknown>;
  /** Boot recovery: what a restart left behind. Runs once, after the pipeline subscribed. */
  sweep?(): Promise<unknown>;
}

/** Run the steps, in order, for one settled conversation. */
export async function settle(
  rt: Pick<AgentRuntime, "readChat">,
  conversationId: number,
  steps: readonly SettledStep[],
  startedAt?: number,
): Promise<void> {
  let read: Promise<ChatState> | undefined;
  let owner: Promise<ConversationOwner | undefined> | undefined;
  const settled: SettledConversation = {
    conversationId,
    chat: () => (read ??= rt.readChat(conversationId)),
    owner: () => (owner ??= conversationOwner(conversationId)),
    ...(startedAt !== undefined ? { startedAt } : {}),
  };
  for (const step of steps) {
    try {
      await step.run(settled);
    } catch (error) {
      logger.warn({ error, conversationId, step: step.name }, "A settled-conversation step failed");
    }
  }
}

export interface SettledPipelineOptions {
  /** Where run notifications go. Default: the app's notification service. */
  notifier?: Notifier;
  /** Memory capture's side-call; without one (faux mode) nothing is captured. */
  memoryCapture?: {
    sideCaller: SideCaller;
    /** MEMORY_CAPTURE_MODEL; otherwise capture uses the bot's own model. */
    model?: string;
  };
}

/**
 * Start the pipeline on the opened runtime: subscribe, then run each step's
 * boot sweep. Returns the stop, which unsubscribes and then disarms capture
 * timers, so nothing calls into the runtime once it closes.
 */
export function startSettledPipeline(
  runtime: AgentRuntime,
  options: SettledPipelineOptions = {},
): () => void {
  const deliveries = createDeliveries(runtime);
  const capture = options.memoryCapture;
  const memoryCapture = capture
    ? createMemoryCapture({
        captureNow: (conversationId) =>
          captureConversation(conversationId, {
            sideCaller: capture.sideCaller,
            model: capture.model,
            readTranscript: async (id) => (await runtime.readChat(id)).messages,
          }),
      })
    : undefined;
  const steps: SettledStep[] = [
    {
      name: "deliveries",
      run: ({ conversationId, chat }) => deliveries.answer(conversationId, chat),
      sweep: () => deliveries.sweep(),
    },
    routineRunsStep(runtime),
    botListStep(),
    runNotificationsStep(options.notifier),
    ...(memoryCapture ? [memoryCapture.onSettled] : []),
  ];
  const turnBudget = turnBudgetOf(runtime);

  const starts = new Map<number, number>();
  const unsubscribe = runtime.onActivity((change) => {
    const conversationId = Number(change.conversation);
    if (change.busy) {
      // Waiting for an approval flips busy again mid-run: the start stays.
      if (!starts.has(conversationId)) starts.set(conversationId, Date.now());
      return;
    }
    // At once, before any step awaits: the next turn's sends count afresh.
    turnBudget.reset(conversationId);
    const startedAt = starts.get(conversationId);
    starts.delete(conversationId);
    void settle(runtime, conversationId, steps, startedAt);
  });

  for (const step of steps) {
    void step
      .sweep?.()
      .catch((error: unknown) =>
        logger.warn({ error, step: step.name }, "A settled-conversation boot sweep failed"),
      );
  }

  return () => {
    unsubscribe();
    memoryCapture?.stop();
  };
}
