/**
 * Whether a live-view panel (the Browser, issue #24, or the Computer, issue
 * #108) opens on its own (friction #37). It opens the first time the bot
 * uses it in a conversation, and an explicit close by the owner is final for
 * that conversation: later calls, in this run or the next, only light the
 * header toggle. On mobile the panel covers the chat, so reopening it under
 * someone who closed it to read the transcript hides exactly what they
 * wanted to see.
 *
 * Dismissals live in sessionStorage so switching bots or reloading the tab
 * keeps them; a new chat is a new conversation and starts fresh. Storage can
 * be unavailable (private mode, blocked site data), so a module-level set
 * backs it for the life of the page.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "./chat-types";
import { viewOf } from "./tool-call-view";

export const BROWSER_DISMISSED_KEY = "tiny-agents:browser-dismissed";
const COMPUTER_DISMISSED_KEY = "tiny-agents:computer-dismissed";
/** Oldest dismissals drop past this; a conversation id is all that's kept. */
const MAX_REMEMBERED = 50;

interface Dismissals {
  has(conversationId: string): boolean;
  add(conversationId: string): void;
  reset(): void;
}

function dismissals(key: string): Dismissals {
  const readStored = (): string[] => {
    try {
      const parsed: unknown = JSON.parse(sessionStorage.getItem(key) ?? "[]");
      return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : [];
    } catch {
      return [];
    }
  };
  const seen = new Set<string>(readStored());
  return {
    has: (conversationId) => seen.has(conversationId) || readStored().includes(conversationId),
    add(conversationId) {
      seen.add(conversationId);
      const ids = [...readStored().filter((id) => id !== conversationId), conversationId];
      try {
        sessionStorage.setItem(key, JSON.stringify(ids.slice(-MAX_REMEMBERED)));
      } catch {
        // The in-memory set still keeps it closed until the page reloads.
      }
    },
    reset() {
      seen.clear();
      try {
        sessionStorage.removeItem(key);
      } catch {
        // nothing stored
      }
    },
  };
}

const browserDismissals = dismissals(BROWSER_DISMISSED_KEY);
const computerDismissals = dismissals(COMPUTER_DISMISSED_KEY);

export function isBrowserDismissed(conversationId: string): boolean {
  return browserDismissals.has(conversationId);
}

/** Test seam: forget every dismissal. */
export function resetBrowserDismissals() {
  browserDismissals.reset();
  computerDismissals.reset();
}

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

function usePanel(store: Dismissals, conversationId: string, inUse: boolean, onOpen?: () => void) {
  const [open, setOpen] = useState(false);
  const onOpenRef = useRef(onOpen);
  useEffect(() => {
    onOpenRef.current = onOpen;
  }, [onOpen]);

  /** Every way the panel opens tells the caller (to bring it to the front). */
  const reveal = useCallback(() => {
    setOpen(true);
    onOpenRef.current?.();
  }, []);

  useEffect(() => {
    if (open || !inUse || store.has(conversationId)) return;
    reveal();
  }, [open, inUse, conversationId, store, reveal]);

  const close = useCallback(() => {
    store.add(conversationId);
    setOpen(false);
  }, [conversationId, store]);

  const toggle = useCallback(() => {
    if (open) close();
    else reveal();
  }, [open, close, reveal]);

  return { open, close, toggle, show: reveal };
}

/**
 * The panel's open state for one conversation. `close` and `toggle` are the
 * owner's actions, so both record the dismissal; only the auto-open reads it.
 */
export function useBrowserPanel(conversationId: string, inUse: boolean, onOpen?: () => void) {
  return usePanel(browserDismissals, conversationId, inUse, onOpen);
}

/** The Computer panel's open state, with dismissals of its own. */
export function useComputerPanel(conversationId: string, inUse: boolean, onOpen?: () => void) {
  return usePanel(computerDismissals, conversationId, inUse, onOpen);
}
