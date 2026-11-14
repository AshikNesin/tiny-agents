/**
 * The bots' chat sessions: one per bot whose chat was opened, kept while
 * the owner looks elsewhere so a revisit shows the cached transcript at
 * once. Each session is a pure `ChatSession` (lib/chat-session.ts); this
 * module is the part that talks to the world:
 *
 * - the bot stream: open while the chat is on screen, its events reduced
 *   into the session, reconnecting (with a fresh snapshot) on its own;
 * - owner sends (GLOSSARY: Echo): the Echo is minted with its request id
 *   and every attempt reuses that id, so the server's idempotent submit can
 *   never place it twice. A send that got no answer while the browser is
 *   offline keeps its Echo and goes again once online; a refusal (an error
 *   answer, or no answer while online) withdraws the Echo, says why and
 *   resolves "restored", so the composer puts the draft back;
 * - stop, withdraw, YOLO mode and older pages;
 * - past chats (issue #101): a read-only session per past chat on screen,
 *   read once (no stream: nothing runs in a retired conversation) and paged
 *   from the past chat's own history, under `pastChatKey`.
 *
 * Everything outside the tab (HTTP, the stream, the online signal, toasts)
 * comes in through `ChatPorts`, so tests drive it with fakes; `chatSessions`
 * is the instance wired to the real ones. Components use `useChat`
 * (store/use-chat.ts), never this store's state directly.
 */
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

/** What the composer hands over for one owner message. */
export interface OwnerSubmission {
  body: string;
  attachments: AttachmentRef[];
  /** Bot ids @mentioned in the body. */
  mentions: string[];
  /** Placement while a reply runs: steer joins it, followUp waits for the next. */
  whenBusy: "steer" | "followUp";
}

/** "sent": accepted, or held to go again once online. "restored": put the draft back. */
export type OwnerSendOutcome = "sent" | "restored";

export interface ChatPorts {
  /** Open the bot's stream; it reconnects on its own until closed. */
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
  /** The page of messages just before `before`. */
  history(botId: string, before: string): Promise<ChatPage>;
  /** A past chat, read once: its newest messages and its routine cards. */
  pastChat(botId: string, chatId: string): Promise<PastChatView>;
  /** The page of a past chat's messages just before `before`. */
  pastChatHistory(botId: string, chatId: string, before: string): Promise<ChatPage>;
  /** The browser's online signal, now. */
  isOnline(): boolean;
  /** Call `listener` once the browser comes back online; returns an unsubscribe. */
  whenOnline(listener: () => void): () => void;
  notifyError(message: string): void;
  newId(): string;
  now(): number;
}

export interface ChatSessionsState {
  /** By bot id for its live chat, by `pastChatKey` for a past chat. */
  sessions: Record<string, ChatSession>;
}

/** The session key of a past chat on screen (a bot's live chat is keyed by the bot's id). */
export function pastChatKey(botId: string, chatId: string): string {
  return `${botId}/history/${chatId}`;
}

/** How a past chat's read ended: read, refused (toasted), or off screen first. */
export type PastChatOutcome = "open" | "failed" | "closed";

/** No answer at all (fetch rejected): the request may or may not have landed. */
function unanswered(error: unknown): boolean {
  return !(error instanceof ApiError);
}

export function createChatSessions(ports: ChatPorts) {
  const store = createStore<ChatSessionsState>(() => ({ sessions: {} }));
  const streams = new Map<string, { close(): void }>();
  /** The past chats on screen, by session key: where their messages come from. */
  const pastChats = new Map<string, { botId: string; chatId: string }>();

  /** Apply `action` to the bot's session; nothing when the chat was dropped meanwhile. */
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
        // Keep the Echo on screen; the same request id goes again once online.
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

    /**
     * The chat is on screen: open its stream (once) and start a visit. A
     * chat seen before keeps its cached transcript and its read marker;
     * `unreadFrom` seeds a new one.
     */
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

    /** Off screen: close the stream. The cached transcript stays for the next visit. */
    close(botId: string): void {
      streams.get(botId)?.close();
      streams.delete(botId);
      dispatch(botId, { type: "closed" });
    },

    /**
     * A past chat is on screen: a fresh read-only session, read once.
     * Resolves "failed" when it could not be read (the reason toasted),
     * "closed" when it left the screen first (nothing toasted or kept).
     */
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

    /**
     * Forget a chat: the bot's (it moved to another conversation, or is
     * gone), or a past chat that left the screen. Close its stream and drop
     * the session, so nothing of the old transcript shows or keeps growing
     * while the new one connects.
     */
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

    /**
     * Echo the message at once and send it. Resolves when the message is
     * placed ("sent") or refused ("restored", the Echo already withdrawn and
     * the reason toasted). While offline it stays and goes again with the
     * same request id once the browser is back.
     */
    send(botId: string, submission: OwnerSubmission): Promise<OwnerSendOutcome> {
      const echo: Echo = {
        requestId: ports.newId(),
        // Exactly the submitted body: a legacy confirmation without a request
        // id is matched by text, so any transformation would leave both.
        text: submission.body,
        createdAt: ports.now(),
        ...(submission.attachments.length > 0 ? { attachments: submission.attachments } : {}),
        offline: false,
      };
      dispatch(botId, { type: "echo", echo });
      return attempt(botId, echo, submission);
    },

    /** Stop the running reply. Rejects (after toasting) when the server refused. */
    async stop(botId: string): Promise<void> {
      try {
        await ports.abort(botId);
      } catch (error) {
        ports.notifyError("Failed to stop the reply");
        throw error;
      }
    },

    /** Withdraw a held (queued or steering) message: the x on its row. */
    async withdraw(botId: string, requestId: string): Promise<void> {
      try {
        await ports.withdraw(botId, requestId);
        // The stream's `queued` event clears the row.
      } catch (error) {
        // A refusal means the message was placed or answered meanwhile; the
        // server's message says which.
        ports.notifyError(errorMessage(error, "Failed to cancel the message"));
      }
    },

    /** Switch YOLO mode (owner only); the stream also says so, this shows it at once. */
    async setYolo(botId: string, on: boolean): Promise<void> {
      try {
        const result = await ports.setYolo(botId, on);
        dispatch(botId, { type: "yolo", on: result.on });
      } catch (error) {
        ports.notifyError(errorMessage(error, "Could not change YOLO mode"));
      }
    },

    /**
     * Fetch the page of messages above the oldest loaded one (issue #92):
     * from the bot's chat, or from the past chat the key names.
     */
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
        // Stay loadable: the next scroll to the top tries again.
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

/** The instance wired to the real stream, HTTP client, browser and toasts. */
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
