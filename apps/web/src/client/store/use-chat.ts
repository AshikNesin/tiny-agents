/**
 * `useChat(botId)`: one bot's chat, live and ready to render, plus what the
 * owner can do in it. While mounted it keeps the bot's stream open
 * (reopening it when the bot moves to another conversation) and clears the
 * bot list's unread flag; the pane renders the view as it is.
 *
 * `usePastChat(botId, chatId)`: a past chat (issue #101), the same session
 * and view, read-only: read once while mounted, and only older pages to load.
 */
import { useEffect, useMemo } from "react";
import { useStore } from "zustand";
import type { PastChat } from "../../shared/api/bots";
import { chatView, newChatSession, type ChatView } from "../lib/chat-session";
import { useBotsStore } from "./bots";
import { chatSessions, pastChatKey, type OwnerSendOutcome, type OwnerSubmission } from "./chats";

export interface ChatHandle extends ChatView {
  /** Echo and send one owner message (see store/chats.ts for its outcomes). */
  send(submission: OwnerSubmission): Promise<OwnerSendOutcome>;
  /** Stop the running reply; rejects (after a toast) when the server refused. */
  stop(): Promise<void>;
  /** Withdraw a held (queued or steering) message. */
  withdraw(requestId: string): Promise<void>;
  /** Switch YOLO mode for this chat (owner only). */
  setYolo(on: boolean): Promise<void>;
  /** Fetch the page above the oldest loaded message. */
  loadOlder(): Promise<void>;
}

/** A chat before its session exists (the first render, before the stream opens). */
const NOT_OPEN = newChatSession();

/** The bot's pre-open read marker, from the list (epoch ms). */
function readMarker(botId: string): number | null {
  const marker = useBotsStore.getState().bots.find((b) => b.id === botId)?.lastReadAt;
  const at = marker ? Date.parse(marker) : Number.NaN;
  return Number.isNaN(at) ? null : at;
}

export function useChat(botId: string): ChatHandle {
  const conversationId = useBotsStore(
    (s) => s.fullBots[botId]?.conversationId ?? s.bots.find((b) => b.id === botId)?.conversationId,
  );
  // (Re)open whenever the bot's conversation changes: "New chat" or a
  // continued Past chat drops the cached chat (`adoptBot`), and the stream
  // must follow the bot to its new conversation.
  useEffect(() => {
    chatSessions.open(botId, readMarker(botId));
    return () => chatSessions.close(botId);
  }, [botId, conversationId]);

  // Opening a bot with unread replies reads them (the list's badge).
  const unread = useBotsStore((s) => s.bots.find((b) => b.id === botId)?.unread);
  const markRead = useBotsStore((s) => s.markRead);
  useEffect(() => {
    if (unread) markRead(botId);
  }, [markRead, unread, botId]);

  const session = useStore(chatSessions.store, (s) => s.sessions[botId]) ?? NOT_OPEN;
  const view = useMemo(() => chatView(session), [session]);
  return useMemo(
    () => ({
      ...view,
      send: (submission: OwnerSubmission) => chatSessions.send(botId, submission),
      stop: () => chatSessions.stop(botId),
      withdraw: (requestId: string) => chatSessions.withdraw(botId, requestId),
      setYolo: (on: boolean) => chatSessions.setYolo(botId, on),
      loadOlder: () => chatSessions.loadOlder(botId),
    }),
    [view, botId],
  );
}

/** A past chat, ready to render: no send, stop, withdraw or YOLO switch. */
export interface PastChatHandle extends ChatView {
  /** Its record (title, dates, message count); null until read. */
  chat: PastChat | null;
  /** Fetch the page above the oldest loaded message. */
  loadOlder(): Promise<void>;
}

/**
 * The past chat `chatId` of the bot, read while mounted and dropped after.
 * `onFailed` runs when it could not be read (the reason already toasted).
 */
export function usePastChat(botId: string, chatId: string, onFailed: () => void): PastChatHandle {
  const key = pastChatKey(botId, chatId);
  useEffect(() => {
    void chatSessions.openPast(botId, chatId).then((outcome) => {
      if (outcome === "failed") onFailed();
    });
    return () => chatSessions.drop(pastChatKey(botId, chatId));
  }, [botId, chatId, onFailed]);

  const session = useStore(chatSessions.store, (s) => s.sessions[key]) ?? NOT_OPEN;
  const view = useMemo(() => chatView(session), [session]);
  return useMemo(
    () => ({
      ...view,
      chat: session.past,
      loadOlder: () => chatSessions.loadOlder(key),
    }),
    [view, session.past, key],
  );
}
