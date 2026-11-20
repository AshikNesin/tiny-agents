import { useEffect, useMemo } from "react";
import { useStore } from "zustand";
import type { PastChat } from "../../shared/api/bots";
import { chatView, newChatSession, type ChatView } from "../lib/chat-session";
import { useBotsStore } from "./bots";
import { chatSessions, pastChatKey, type OwnerSendOutcome, type OwnerSubmission } from "./chats";

export interface ChatHandle extends ChatView {
  send(submission: OwnerSubmission): Promise<OwnerSendOutcome>;
  stop(): Promise<void>;
  withdraw(requestId: string): Promise<void>;
  setYolo(on: boolean): Promise<void>;
  loadOlder(): Promise<void>;
}

const NOT_OPEN = newChatSession();

function readMarker(botId: string): number | null {
  const marker = useBotsStore.getState().bots.find((b) => b.id === botId)?.lastReadAt;
  const at = marker ? Date.parse(marker) : Number.NaN;
  return Number.isNaN(at) ? null : at;
}

export function useChat(botId: string): ChatHandle {
  const conversationId = useBotsStore(
    (s) => s.fullBots[botId]?.conversationId ?? s.bots.find((b) => b.id === botId)?.conversationId,
  );
  useEffect(() => {
    chatSessions.open(botId, readMarker(botId));
    return () => chatSessions.close(botId);
  }, [botId, conversationId]);

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

export interface PastChatHandle extends ChatView {
  chat: PastChat | null;
  loadOlder(): Promise<void>;
}

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
