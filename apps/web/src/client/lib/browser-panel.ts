import { useCallback, useState } from "react";
import type { ChatMessage } from "./chat-types";
import { viewOf } from "./tool-call-view";
import { readStored, writeStored } from "./browser-storage";

export type LiveLayout = "docked" | "pip";

const LIVE_LAYOUT_KEY = "tiny-agents:live-view-layout";

export function browserInUse(messages: ChatMessage[]): boolean {
  return messages.some(
    (m) =>
      m.role === "assistant" &&
      m.toolCalls?.some((c) => c.name.startsWith("browser_") && viewOf(c).phase === "running"),
  );
}

export function computerInUse(messages: ChatMessage[]): boolean {
  return messages.some(
    (m) =>
      m.role === "assistant" &&
      m.toolCalls?.some((c) => {
        if (!c.name.startsWith("computer_")) return false;
        const view = viewOf(c);
        return view.phase === "running" || view.waitingOn === "takeover";
      }),
  );
}

function readLayout(): LiveLayout {
  return readStored(LIVE_LAYOUT_KEY) === "pip" ? "pip" : "docked";
}

export function useLiveLayout() {
  const [layout, setLayoutState] = useState<LiveLayout>(readLayout);
  const setLayout = useCallback((next: LiveLayout) => {
    setLayoutState(next);
    writeStored(LIVE_LAYOUT_KEY, next);
  }, []);
  return [layout, setLayout] as const;
}
