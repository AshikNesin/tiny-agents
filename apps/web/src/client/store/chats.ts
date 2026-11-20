import { createStore } from "zustand/vanilla";
import { toast } from "sonner";
import { ApiError } from "@groot/shell/lib/api";
import { botsApi } from "../lib/bots-api";
import { subscribeSse } from "../lib/sse";
import { errorMessage } from "../lib/errors";
import { oldestEntryId } from "../lib/chat-history";
import {
  newChatSession,
  reduceChat,
  type ChatAction,
  type ChatSession,
  type Echo,
} from "../lib/chat-session";
import type { AttachmentRef, BotStreamEvent, ChatPage } from "../lib/chat-types";
import type { PastChatView } from "../../shared/api/bots";

export interface OwnerSubmission {
  body: string;
  attachments: AttachmentRef[];
  mentions: string[];
  whenBusy: "steer" | "followUp";
}

export type OwnerSendOutcome = "sent" | "restored";

export interface ChatPorts {
  stream(
    botId: string,
    handlers: {
      onEvent(event: BotStreamEvent): void;
      onOpen(): void;
      onDrop(): void;
    },
  ): { close(): void };
  send(
    botId: string,
    requestId: string,
    body: string,
    mentions: string[],
    attachmentIds: string[],
    whenBusy: "steer" | "followUp",
  ): Promise<unknown>;
  withdraw(botId: string, requestId: string): Promise<unknown>;
  abort(botId: string): Promise<unknown>;
  setYolo(botId: string, on: boolean): Promise<{ on: boolean }>;
  history(botId: string, before: string): Promise<ChatPage>;
  pastChat(botId: string, chatId: string): Promise<PastChatView>;
  pastChatHistory(botId: string, chatId: string, before: string): Promise<ChatPage>;
  isOnline(): boolean;
  whenOnline(listener: () => void): () => void;
  notifyError(message: string): void;
  newId(): string;
  now(): number;
}

export interface ChatSessionsState {
  sessions: Record<string, ChatSession>;
}

export function pastChatKey(botId: string, chatId: string): string {
  return `${botId}/history/${chatId}`;
}

export type PastChatOutcome = "open" | "failed" | "closed";

function unanswered(error: unknown): boolean {
  return !(error instanceof ApiError);
}

export function createChatSessions(ports: ChatPorts) {
  const store = createStore<ChatSessionsState>(() => ({ sessions: {} }));
  const streams = new Map<string, { close(): void }>();
  const pastChats = new Map<string, { botId: string; chatId: string }>();

  const dispatch = (botId: string, action: ChatAction) =>
    store.setState((state) => {
      const session = state.sessions[botId];
      if (!session) return state;
      const next = reduceChat(session, action);
      return next === session ? state : { sessions: { ...state.sessions, [botId]: next } };
    });

  async function attempt(
    botId: string,
    echo: Echo,
    submission: OwnerSubmission,
  ): Promise<OwnerSendOutcome> {
    try {
      await ports.send(
        botId,
        echo.requestId,
        submission.body,
        submission.mentions,
        submission.attachments.map((a) => a.uploadId),
        submission.whenBusy,
      );
      return "sent";
    } catch (error) {
      if (unanswered(error) && !ports.isOnline()) {
        dispatch(botId, { type: "echo-offline", requestId: echo.requestId });
        return new Promise<OwnerSendOutcome>((resolve) => {
          const stop = ports.whenOnline(() => {
            stop();
            dispatch(botId, { type: "echo-retry", requestId: echo.requestId });
            resolve(attempt(botId, echo, submission));
          });
        });
      }
      dispatch(botId, { type: "echo-refused", requestId: echo.requestId });
      ports.notifyError(errorMessage(error, "Failed to send"));
      return "restored";
    }
  }

  return {
    store,

    open(botId: string, unreadFrom: number | null): void {
      if (streams.has(botId)) return;
      store.setState((state) => ({
        sessions: {
          ...state.sessions,
          [botId]: reduceChat(state.sessions[botId] ?? newChatSession(unreadFrom), {
            type: "opened",
          }),
        },
      }));
      streams.set(
        botId,
        ports.stream(botId, {
          onEvent: (event) => dispatch(botId, event),
          onOpen: () => dispatch(botId, { type: "stream-open" }),
          onDrop: () => dispatch(botId, { type: "stream-drop" }),
        }),
      );
    },

    close(botId: string): void {
      streams.get(botId)?.close();
      streams.delete(botId);
      dispatch(botId, { type: "closed" });
    },

    async openPast(botId: string, chatId: string): Promise<PastChatOutcome> {
      const key = pastChatKey(botId, chatId);
      const source = { botId, chatId };
      pastChats.set(key, source);
      store.setState((state) => ({
        sessions: { ...state.sessions, [key]: newChatSession() },
      }));
      try {
        const view = await ports.pastChat(botId, chatId);
        if (pastChats.get(key) !== source) return "closed";
        dispatch(key, { type: "past-chat", view });
        return "open";
      } catch (error) {
        if (pastChats.get(key) !== source) return "closed";
        ports.notifyError(errorMessage(error, "Failed to open the past chat"));
        return "failed";
      }
    },

    drop(key: string): void {
      streams.get(key)?.close();
      streams.delete(key);
      pastChats.delete(key);
      store.setState((state) => {
        if (!state.sessions[key]) return state;
        const sessions = { ...state.sessions };
        delete sessions[key];
        return { sessions };
      });
    },

    send(botId: string, submission: OwnerSubmission): Promise<OwnerSendOutcome> {
      const echo: Echo = {
        requestId: ports.newId(),
        text: submission.body,
        createdAt: ports.now(),
        ...(submission.attachments.length > 0 ? { attachments: submission.attachments } : {}),
        offline: false,
      };
      dispatch(botId, { type: "echo", echo });
      return attempt(botId, echo, submission);
    },

    async stop(botId: string): Promise<void> {
      try {
        await ports.abort(botId);
      } catch (error) {
        ports.notifyError("Failed to stop the reply");
        throw error;
      }
    },

    async withdraw(botId: string, requestId: string): Promise<void> {
      try {
        await ports.withdraw(botId, requestId);
      } catch (error) {
        ports.notifyError(errorMessage(error, "Failed to cancel the message"));
      }
    },

    async setYolo(botId: string, on: boolean): Promise<void> {
      try {
        const result = await ports.setYolo(botId, on);
        dispatch(botId, { type: "yolo", on: result.on });
      } catch (error) {
        ports.notifyError(errorMessage(error, "Could not change YOLO mode"));
      }
    },

    async loadOlder(key: string): Promise<void> {
      const session = store.getState().sessions[key];
      const before = session ? oldestEntryId(session.messages) : undefined;
      if (!session || !session.hasMore || session.loadingOlder || !before) return;
      const past = pastChats.get(key);
      dispatch(key, { type: "older-loading" });
      try {
        const page = past
          ? await ports.pastChatHistory(past.botId, past.chatId, before)
          : await ports.history(key, before);
        dispatch(key, { type: "older-page", before, page });
      } catch {
        dispatch(key, { type: "older-failed" });
      }
    },
  };
}

export type ChatSessions = ReturnType<typeof createChatSessions>;

function whenBrowserOnline(listener: () => void): () => void {
  window.addEventListener("online", listener);
  return () => window.removeEventListener("online", listener);
}

export const chatSessions: ChatSessions = createChatSessions({
  stream: (botId, { onEvent, onOpen, onDrop }) =>
    subscribeSse(`/api/v1/bots/${botId}/stream`, (event) => onEvent(event as BotStreamEvent), {
      onOpen,
      onDrop,
    }),
  send: (botId, requestId, body, mentions, attachmentIds, whenBusy) =>
    botsApi.send(botId, requestId, body, mentions, attachmentIds, whenBusy),
  withdraw: (botId, requestId) => botsApi.withdraw(botId, requestId),
  abort: (botId) => botsApi.abort(botId),
  setYolo: (botId, on) => botsApi.setYolo(botId, on),
  history: (botId, before) => botsApi.history(botId, before),
  pastChat: (botId, chatId) => botsApi.pastChat(botId, chatId),
  pastChatHistory: (botId, chatId, before) => botsApi.pastChatHistory(botId, chatId, before),
  isOnline: () => navigator.onLine,
  whenOnline: whenBrowserOnline,
  notifyError: (message) => toast.error(message),
  newId: () => crypto.randomUUID(),
  now: () => Date.now(),
});
