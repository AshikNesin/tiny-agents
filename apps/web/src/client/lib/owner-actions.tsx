/**
 * Owner actions: the decisions a transcript's cards ask of the owner.
 * An approval card decides a tool call, a vault card decides a vault use,
 * and a Question card answers or dismisses the bot's questions.
 *
 * The transcript gets one `OwnerActions` for its bot through
 * `OwnerActionsProvider`. A Past chat provides none: what still waits there
 * can no longer be answered, so its cards render without actions. The live
 * chat provides `httpOwnerActions(botId)`; tests provide a recording fake.
 */
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { botsApi } from "./bots-api";
import type { OwnerAnswer } from "./chat-types";
import { errorMessage } from "./errors";

export interface OwnerActions {
  /**
   * Approve or deny a tool call waiting at `taskId`. `alwaysAllow` (a tool
   * name) also stops asking for that tool; `grant` (vault cards) approves the
   * vault item for the rest of the conversation.
   */
  decideApproval(
    taskId: number,
    decision: "approved" | "denied",
    options?: { alwaysAllow?: string; grant?: boolean },
  ): Promise<unknown>;
  /** Answer a bot's questions (one answer per question), or dismiss them with `null`. */
  answerQuestions(taskId: number, answers: OwnerAnswer[] | null): Promise<unknown>;
  /**
   * Hand the bot's computer back after a takeover it asked for (issue #108).
   * Absent where the chat cannot reach the computer.
   */
  handBackComputer?(): Promise<unknown>;
}

/** Window event the chat listens for to bring the Computer panel up. */
export const SHOW_COMPUTER_EVENT = "tiny-agents:show-computer";

export function showComputerPanel(): void {
  window.dispatchEvent(new Event(SHOW_COMPUTER_EVENT));
}

/** The HTTP adapter: owner actions for one bot's live chat. */
function httpOwnerActions(botId: string): OwnerActions {
  return {
    decideApproval: (taskId, decision, options = {}) =>
      botsApi.decideApproval(botId, taskId, decision, options.alwaysAllow, options.grant),
    answerQuestions: (taskId, answers) => botsApi.answerQuestions(botId, taskId, answers),
    handBackComputer: () => botsApi.computerDriver(botId, "agent"),
  };
}

const OwnerActionsContext = createContext<OwnerActions | undefined>(undefined);

export function OwnerActionsProvider({
  actions,
  children,
}: {
  actions: OwnerActions | undefined;
  children: ReactNode;
}) {
  return <OwnerActionsContext.Provider value={actions}>{children}</OwnerActionsContext.Provider>;
}

/** The owner actions in scope; undefined in a read-only transcript (a Past chat). */
export function useOwnerActions(): OwnerActions | undefined {
  return useContext(OwnerActionsContext);
}

/**
 * The pending and error behaviour every card shares: one decision at a time,
 * its failure toasted. A card the stream will replace once answered keeps
 * `busy` after a success (`settle: false`), so it cannot be answered twice.
 */
export function useOwnerDecision(failure: string, { settle = true }: { settle?: boolean } = {}) {
  const [busy, setBusy] = useState(false);
  const run = async (decide: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      await decide();
      if (settle) setBusy(false);
    } catch (error) {
      toast.error(errorMessage(error, failure));
      setBusy(false);
    }
  };
  return { busy, run };
}

/** `httpOwnerActions(botId)`, stable across renders. */
export function useHttpOwnerActions(botId: string): OwnerActions {
  return useMemo(() => httpOwnerActions(botId), [botId]);
}
