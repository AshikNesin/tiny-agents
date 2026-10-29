/**
 * Whether the Browser panel opens on its own (friction #37). It opens the
 * first time the bot drives its browser in a conversation, and an explicit
 * close by the owner is final for that conversation: later browser calls,
 * in this run or the next, only light the header toggle. On mobile the panel
 * covers the chat, so reopening it under someone who closed it to read the
 * transcript hides exactly what they wanted to see.
 *
 * Dismissals live in sessionStorage so switching bots or reloading the tab
 * keeps them; a new chat is a new conversation and starts fresh. Storage can
 * be unavailable (private mode, blocked site data), so a module-level set
 * backs it for the life of the page.
 */
import { useCallback, useEffect, useState } from "react";
import type { ChatMessage } from "./chat-types";

export const BROWSER_DISMISSED_KEY = "tiny-agents:browser-dismissed";
/** Oldest dismissals drop past this; a conversation id is all that's kept. */
const MAX_REMEMBERED = 50;

const dismissed = new Set<string>(readStored());

function readStored(): string[] {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(BROWSER_DISMISSED_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function isBrowserDismissed(conversationId: string): boolean {
  return dismissed.has(conversationId) || readStored().includes(conversationId);
}

export function dismissBrowser(conversationId: string) {
  dismissed.add(conversationId);
  const ids = [...readStored().filter((id) => id !== conversationId), conversationId];
  try {
    sessionStorage.setItem(BROWSER_DISMISSED_KEY, JSON.stringify(ids.slice(-MAX_REMEMBERED)));
  } catch {
    // The in-memory set still keeps it closed until the page reloads.
  }
}

/** Test seam: forget every dismissal. */
export function resetBrowserDismissals() {
  dismissed.clear();
  try {
    sessionStorage.removeItem(BROWSER_DISMISSED_KEY);
  } catch {
    // nothing stored
  }
}

/** The bot is running a browser tool right now. */
export function browserInUse(messages: ChatMessage[]): boolean {
  return messages.some(
    (m) =>
      m.role === "assistant" &&
      m.toolCalls?.some((c) => c.name.startsWith("browser_") && c.status === "running"),
  );
}

/**
 * The panel's open state for one conversation. `close` and `toggle` are the
 * owner's actions, so both record the dismissal; only the auto-open reads it.
 */
export function useBrowserPanel(conversationId: string, inUse: boolean) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (open || !inUse || isBrowserDismissed(conversationId)) return;
    setOpen(true);
  }, [open, inUse, conversationId]);

  const close = useCallback(() => {
    dismissBrowser(conversationId);
    setOpen(false);
  }, [conversationId]);

  const toggle = useCallback(() => {
    if (open) close();
    else setOpen(true);
  }, [open, close]);

  return { open, close, toggle };
}
