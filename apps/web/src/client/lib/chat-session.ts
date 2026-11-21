import type { PastChat, PastChatView } from "../../shared/api/bots";
import { mergeSnapshot, oldestEntryId, prependOlder } from "./chat-history";
import { chatTimeline, type TimelineItem } from "./chat-timeline";
import { isActive } from "./tool-call-view";
import type {
  AttachmentRef,
  BotStreamEvent,
  ChatAuthor,
  ChatMessage,
  ChatPage,
  QueuedMessage,
  RoutineRunCard,
} from "./chat-types";

export interface Echo {
  requestId: string;
  text: string;
  createdAt: number;
  attachments?: AttachmentRef[];
  offline: boolean;
}

export interface ChatSession {
  messages: ChatMessage[];
  hasMore: boolean;
  loadingOlder: boolean;
  busy: boolean;
  queued: readonly QueuedMessage[];
  routineRuns: RoutineRunCard[];
  yolo: boolean | undefined;
  echoes: Echo[];
  connected: boolean;
  loaded: boolean;
  unreadFrom: number | null;
  dividerId: string | null | undefined;
  past: PastChat | null;
}

export type ChatAction =
  | BotStreamEvent
  | { type: "opened" }
  | { type: "closed" }
  | { type: "stream-open" }
  | { type: "stream-drop" }
  | { type: "echo"; echo: Echo }
  | { type: "echo-offline"; requestId: string }
  | { type: "echo-retry"; requestId: string }
  | { type: "echo-refused"; requestId: string }
  | { type: "older-loading" }
  | { type: "older-page"; before: string; page: ChatPage }
  | { type: "older-failed" }
  | { type: "past-chat"; view: PastChatView };

export function newChatSession(unreadFrom: number | null = null): ChatSession {
  return {
    messages: [],
    hasMore: false,
    loadingOlder: false,
    busy: false,
    queued: [],
    routineRuns: [],
    yolo: undefined,
    echoes: [],
    connected: false,
    loaded: false,
    unreadFrom,
    dividerId: undefined,
    past: null,
  };
}

function attachmentIds(message: { attachments?: { uploadId: string }[] }): string {
  return (message.attachments ?? [])
    .map((a) => a.uploadId)
    .sort()
    .join(",");
}

const LEGACY_ECHO_SKEW_MS = 5_000;

function echoMatches(
  echo: Pick<Echo, "requestId" | "text" | "createdAt" | "attachments">,
  message: Pick<ChatMessage, "text" | "requestId" | "createdAt" | "attachments">,
): boolean {
  if (message.requestId) return message.requestId === echo.requestId;
  return (
    message.createdAt >= echo.createdAt - LEGACY_ECHO_SKEW_MS &&
    echo.text.trim() === message.text.trim() &&
    attachmentIds(echo) === attachmentIds(message)
  );
}

function unconfirmed(
  echoes: Echo[],
  messages: readonly ChatMessage[],
  queued: readonly QueuedMessage[],
): Echo[] {
  const left = echoes.filter(
    (echo) =>
      !messages.some((m) => m.role === "user" && echoMatches(echo, m)) &&
      !queued.some((q) => q.requestId === echo.requestId),
  );
  return left.length === echoes.length ? echoes : left;
}

function firstUnreadReply(messages: ChatMessage[], unreadFrom: number | null): string | null {
  return (
    messages.find((m) => m.role === "assistant" && m.createdAt > (unreadFrom ?? 0))?.id ?? null
  );
}

function patchEcho(state: ChatSession, requestId: string, offline: boolean): ChatSession {
  if (!state.echoes.some((echo) => echo.requestId === requestId)) return state;
  return {
    ...state,
    echoes: state.echoes.map((echo) =>
      echo.requestId === requestId ? { ...echo, offline } : echo,
    ),
  };
}

export function reduceChat(state: ChatSession, action: ChatAction): ChatSession {
  switch (action.type) {
    case "snapshot": {
      const queued = action.state.queued ?? [];
      const { messages, hasMore } = mergeSnapshot(state, action.state);
      return {
        ...state,
        messages,
        hasMore,
        loadingOlder: false,
        busy: action.state.busy,
        queued,
        echoes: unconfirmed(state.echoes, action.state.messages, queued),
        connected: true,
        loaded: true,
        dividerId:
          state.dividerId === undefined
            ? firstUnreadReply(messages, state.unreadFrom)
            : state.dividerId,
      };
    }
    case "upsert": {
      const { message } = action;
      return {
        ...state,
        echoes: message.role === "user" ? unconfirmed(state.echoes, [message], []) : state.echoes,
        messages: state.messages.some((m) => m.id === message.id)
          ? state.messages.map((m) => (m.id === message.id ? message : m))
          : [...state.messages, message],
      };
    }
    case "remove":
      return {
        ...state,
        messages: state.messages.filter((m) => m.id !== action.id),
      };
    case "delta":
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.id === action.id
            ? {
                ...m,
                text: m.text + (action.text ?? ""),
                reasoning: (m.reasoning ?? "") + (action.reasoning ?? ""),
              }
            : m,
        ),
      };
    case "queued":
      return {
        ...state,
        queued: action.items,
        echoes: unconfirmed(state.echoes, [], action.items),
      };
    case "busy":
      return { ...state, busy: action.busy };
    case "routine-runs":
      return { ...state, routineRuns: action.runs };
    case "routine-run":
      return state.routineRuns.some((run) => run.id === action.run.id)
        ? state
        : { ...state, routineRuns: [...state.routineRuns, action.run] };
    case "yolo":
      return state.yolo === action.on ? state : { ...state, yolo: action.on };
    case "ping":
      return state;
    case "error":
      return { ...state, connected: false };
    case "opened":
      return { ...state, dividerId: undefined };
    case "closed":
      return { ...state, connected: false, loaded: false };
    case "stream-open":
      return { ...state, connected: true };
    case "stream-drop":
      return { ...state, connected: false };
    case "echo":
      return { ...state, echoes: [...state.echoes, action.echo] };
    case "echo-offline":
      return patchEcho(state, action.requestId, true);
    case "echo-retry":
      return patchEcho(state, action.requestId, false);
    case "echo-refused":
      return {
        ...state,
        echoes: state.echoes.filter((echo) => echo.requestId !== action.requestId),
      };
    case "older-loading":
      return { ...state, loadingOlder: true };
    case "older-page":
      return oldestEntryId(state.messages) === action.before
        ? {
            ...state,
            ...prependOlder(state.messages, action.page),
            loadingOlder: false,
          }
        : { ...state, loadingOlder: false };
    case "older-failed":
      return { ...state, loadingOlder: false };
    case "past-chat":
      return {
        ...reduceChat(state, { type: "snapshot", state: action.view.state }),
        routineRuns: action.view.runs,
        past: action.view.chat,
      };
  }
}

export interface OutboxEntry {
  requestId: string;
  text: string;
  attachments?: AttachmentRef[];
  state: "sending" | "offline" | "steering" | "queued";
  createdAt?: number;
  author?: ChatAuthor;
}

export function isEcho(entry: OutboxEntry): boolean {
  return entry.state === "sending" || entry.state === "offline";
}

function awaitingFirstOutput(messages: ChatMessage[]): boolean {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "assistant") return true;
  if (last.status === "streaming") return false;
  return !last.toolCalls?.some(isActive);
}

export interface ChatView {
  messages: ChatMessage[];
  timeline: TimelineItem[];
  outbox: OutboxEntry[];
  busy: boolean;
  typing: boolean;
  health: "loading" | "live" | "reconnecting";
  hasMore: boolean;
  loadingOlder: boolean;
  unreadDividerId: string | null;
  isRead: (index: number) => boolean;
  yolo: boolean;
}

export function chatView(session: ChatSession): ChatView {
  const { messages, echoes, queued, busy } = session;
  const held: OutboxEntry[] = queued.map((item) => ({
    requestId: item.requestId,
    text: item.text,
    ...(item.attachments?.length ? { attachments: item.attachments } : {}),
    state: item.mode === "steer" ? "steering" : "queued",
    ...(item.author ? { author: item.author } : {}),
  }));
  const echoed: OutboxEntry[] = echoes.map((echo) => ({
    requestId: echo.requestId,
    text: echo.text,
    ...(echo.attachments?.length ? { attachments: echo.attachments } : {}),
    state: echo.offline ? "offline" : "sending",
    createdAt: echo.createdAt,
  }));
  const timeline: TimelineItem[] = [
    ...chatTimeline(messages, session.routineRuns),
    ...echoed.map((echo) => ({
      kind: "echo" as const,
      echo,
      at: echo.createdAt ?? 0,
    })),
  ];
  const firstUnread = messages.findIndex((m) => m.createdAt > (session.unreadFrom ?? 0));
  return {
    messages,
    timeline,
    outbox: [...echoed, ...held],
    busy,
    typing: busy && echoes.length === 0 && awaitingFirstOutput(messages),
    health: !session.loaded ? "loading" : session.connected ? "live" : "reconnecting",
    hasMore: session.hasMore,
    loadingOlder: session.loadingOlder,
    unreadDividerId: session.dividerId ?? null,
    isRead: (index) => firstUnread === -1 || index < firstUnread,
    yolo: session.yolo === true,
  };
}
