/**
 * The chat's live views (the Browser, issue #24, and the Computer, issue
 * #108): when the bot is using one, and how the owner likes to watch it.
 *
 * Neither opens on its own. A bot reaching for its browser used to pop the
 * panel open over the chat; now it only lights the header's live-view toggle,
 * and the owner opens the view when they want it.
 *
 * The owner watches either docked (beside the chat on desktop, over it on a
 * phone) or as picture in picture: a small floating view that keeps the chat
 * readable. The choice is remembered in localStorage.
 */
import { useCallback, useState } from "react";
import type { ChatMessage } from "./chat-types";
import { viewOf } from "./tool-call-view";

export type LiveLayout = "docked" | "pip";

const LIVE_LAYOUT_KEY = "tiny-agents:live-view-layout";

/** The bot is running a browser tool right now. */
export function browserInUse(messages: ChatMessage[]): boolean {
  return messages.some(
    (m) =>
      m.role === "assistant" &&
      m.toolCalls?.some((c) => c.name.startsWith("browser_") && viewOf(c).phase === "running"),
  );
}

/** The bot is running a computer tool right now, or waits for the owner to take over. */
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
  try {
    return window.localStorage.getItem(LIVE_LAYOUT_KEY) === "pip" ? "pip" : "docked";
  } catch {
    return "docked";
  }
}

/** Docked or picture in picture, remembered across chats and reloads. */
export function useLiveLayout() {
  const [layout, setLayoutState] = useState<LiveLayout>(readLayout);
  const setLayout = useCallback((next: LiveLayout) => {
    setLayoutState(next);
    try {
      window.localStorage.setItem(LIVE_LAYOUT_KEY, next);
    } catch {
      /* storage unavailable: the choice lasts until the page reloads */
    }
  }, []);
  return [layout, setLayout] as const;
}
