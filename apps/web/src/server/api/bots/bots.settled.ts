import { logger } from "@groot/core/logger";
import type { AgentRuntime, ChatState } from "@tiny-agents/agent";
import { conversationOwner, type ConversationOwner } from "./bots.owner";
import { createDeliveries } from "./bots.delivery";
import { botListStep } from "./bots.list";
import { turnBudgetOf } from "./bots.messaging";
import { memoryCaptureStep } from "./memories.runner";
import type { SideCaller } from "./side-call";
import { routineRunsStep } from "../routines/routines.watcher";
import { runNotificationsStep, type Notifier } from "../notifications/notifications.wiring";

export type ChatRead = () => Promise<ChatState>;

interface SettledConversation {
  conversationId: number;
  chat: ChatRead;
  owner: () => Promise<ConversationOwner | undefined>;
  startedAt?: number;
}

export interface SettledStep {
  name: string;
  run(settled: SettledConversation): Promise<unknown>;
  sweep?(): Promise<unknown>;
}

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
  notifier?: Notifier;
  memoryCapture?: {
    sideCaller: SideCaller;
  };
}

export function startSettledPipeline(
  runtime: AgentRuntime,
  options: SettledPipelineOptions = {},
): () => void {
  const deliveries = createDeliveries(runtime);
  const memoryCapture = memoryCaptureStep(
    options.memoryCapture?.sideCaller,
    async (id) => (await runtime.readChat(id)).messages,
  );
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
      if (!starts.has(conversationId)) starts.set(conversationId, Date.now());
      return;
    }
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
    void memoryCapture?.stop();
  };
}
