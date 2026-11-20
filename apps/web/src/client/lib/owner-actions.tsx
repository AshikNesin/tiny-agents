import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { botsApi } from "./bots-api";
import type { OwnerAnswer } from "./chat-types";
import { errorMessage } from "./errors";

export interface OwnerActions {
  decideApproval(
    taskId: number,
    decision: "approved" | "denied",
    options?: { alwaysAllow?: string; grant?: boolean },
  ): Promise<unknown>;
  answerQuestions(taskId: number, answers: OwnerAnswer[] | null): Promise<unknown>;
  handBackComputer?(): Promise<unknown>;
}

export const SHOW_COMPUTER_EVENT = "tiny-agents:show-computer";

export function showComputerPanel(): void {
  window.dispatchEvent(new Event(SHOW_COMPUTER_EVENT));
}

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

export function useOwnerActions(): OwnerActions | undefined {
  return useContext(OwnerActionsContext);
}

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

export function useHttpOwnerActions(botId: string): OwnerActions {
  return useMemo(() => httpOwnerActions(botId), [botId]);
}
