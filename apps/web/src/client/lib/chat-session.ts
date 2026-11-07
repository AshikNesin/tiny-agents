/**
 * One bot's chat as the browser holds it, pure: what the bot stream said,
 * what only the browser knows (Echoes, stream health, paging, the read
 * marker), the one reducer every change goes through, and the view the chat
 * pane renders. The store (store/chats.ts) runs the stream and the sends
 * and feeds their outcomes here; `useChat` (store/use-chat.ts) hands the
 * view to the pane.
 *
 * An owner message has one life here, from its Echo to the server's
 * confirmation (GLOSSARY: Echo, Outbox): it is an Echo while its send is in
 * flight or waits for the browser to be back online, a queued item while
 * the server holds it behind (or steering into) the running reply, and a
 * transcript message once placed.
 */
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

/** The optimistic copy of an owner send, shown until the server confirms it (GLOSSARY: Echo). */
export interface Echo {
  /** The send's request id: minted once, reused by every retry, and what confirms the Echo. */
  requestId: string;
  /** Exactly the submitted body: a legacy confirmation without a request id is matched by it. */
  text: string;
  /** Browser clock, when it was sent. */
  createdAt: number;
  attachments?: AttachmentRef[];
  /** No answer came while the browser was offline: it goes again, same id, once online. */
  offline: boolean;
}

export interface ChatSession {
  /** The transcript loaded so far: the stream's window plus older pages. */
  messages: ChatMessage[];
  /** Older messages exist above `messages[0]`; they load on scroll (issue #92). */
  hasMore: boolean;
  /** A page of older messages is being fetched. */
  loadingOlder: boolean;
  busy: boolean;
  /** Owner inputs the server holds behind (or steering into) the reply. */
  queued: readonly QueuedMessage[];
  /** Finished routine runs of this bot, oldest first (issue #63). */
  routineRuns: RoutineRunCard[];
  /** YOLO mode (issue #151); unknown until its stream event arrives. */
  yolo: boolean | undefined;
  /** Owner sends not yet confirmed, oldest first. */
  echoes: Echo[];
  /** False while the stream is down (backend restart, network drop). */
  connected: boolean;
  /**
   * True once this visit's first snapshot arrived. Until then the transcript
   * is unknown (or a stale cache), not empty: no empty state, no
   * "Reconnecting…" notice while the first connection opens.
   */
  loaded: boolean;
  /**
   * Pre-open read marker (epoch ms), seeded when the chat is first opened
   * and never advanced: messages newer than it arrived while the owner was
   * away (issue #3).
   */
  unreadFrom: number | null;
  /**
   * The bot reply the "New messages" divider goes above: fixed by the first
   * snapshot of each visit, so replies that stream in while the chat is open
   * are never flagged. `undefined` until that snapshot, `null` for none.
   */
  dividerId: string | null | undefined;
}

/**
 * Everything that changes a chat: an event of the bot stream, or the
 * browser's own (the chat opening and closing, the stream's health, an
 * owner send's progress, a page of older messages).
 */
export type ChatAction =
  | BotStreamEvent
  /** The chat is on screen again: a new visit, whose first snapshot places the divider. */
  | { type: "opened" }
  /** Off screen: the cache stays, but is stale until the next visit's snapshot. */
  | { type: "closed" }
  | { type: "stream-open" }
  | { type: "stream-drop" }
  | { type: "echo"; echo: Echo }
  | { type: "echo-offline"; requestId: string }
  | { type: "echo-retry"; requestId: string }
  /** The server refused the send (or no answer while online): the draft goes back. */
  | { type: "echo-refused"; requestId: string }
  | { type: "older-loading" }
  | { type: "older-page"; before: string; page: ChatPage }
  | { type: "older-failed" };

/** A chat with nothing known yet: before its first snapshot. */
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
  };
}

/** Attachment ids of a message, for echo matching (empty texts collide). */
function attachmentIds(message: { attachments?: { uploadId: string }[] }): string {
  return (message.attachments ?? [])
    .map((a) => a.uploadId)
    .sort()
    .join(",");
}

/**
 * How far a legacy confirmation's server clock may run behind the Echo's
 * browser clock and still count as that Echo's.
 */
const LEGACY_ECHO_SKEW_MS = 5_000;

/**
 * Whether a confirmed user message is `echo`'s: by request id, which every
 * owner send records. A message without one (written before request ids
 * were recorded on every send) falls back to its text and attachments, and
 * only when it is not older than the Echo: an earlier message with the same
 * text ("ok") is never mistaken for a new Echo.
 */
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

/** Echoes still waiting: not confirmed by these messages, not held by the server as queued. */
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

/** The first bot reply newer than the read marker (only replies count, friction #32). */
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

/** The chat reducer: every stream event and every browser change lands here. */
export function reduceChat(state: ChatSession, action: ChatAction): ChatSession {
  switch (action.type) {
    case "snapshot": {
      // A fresh snapshot is authoritative. A reconnect's is the newest
      // window again: the older pages already loaded stay above it.
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
        // The confirmed user message replaces its Echo.
        echoes: message.role === "user" ? unconfirmed(state.echoes, [message], []) : state.echoes,
        messages: state.messages.some((m) => m.id === message.id)
          ? state.messages.map((m) => (m.id === message.id ? message : m))
          : [...state.messages, message],
      };
    }
    case "remove":
      return { ...state, messages: state.messages.filter((m) => m.id !== action.id) };
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
      // The server holds these: their Echoes are superseded by the queued items.
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
      // Listed and followed at connect, a run can arrive twice: keep one.
      return state.routineRuns.some((run) => run.id === action.run.id)
        ? state
        : { ...state, routineRuns: [...state.routineRuns, action.run] };
    case "yolo":
      return state.yolo === action.on ? state : { ...state, yolo: action.on };
    case "ping":
      return state;
    case "error":
      // The stream gave up on this connection; it reconnects with a fresh snapshot.
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
      // A new chat or a fresh snapshot meanwhile: this page no longer fits.
      return oldestEntryId(state.messages) === action.before
        ? { ...state, ...prependOlder(state.messages, action.page), loadingOlder: false }
        : { ...state, loadingOlder: false };
    case "older-failed":
      return { ...state, loadingOlder: false };
  }
}

/**
 * One entry of the chat's outbox (GLOSSARY: Outbox): an owner message the
 * transcript does not hold yet.
 * - `sending`: its Echo, while the send is in flight or unconfirmed.
 * - `offline`: its Echo, waiting to go again once the browser is online.
 * - `steering`: the server holds it to join the running reply.
 * - `queued`: the server holds it for the next reply.
 */
export interface OutboxEntry {
  requestId: string;
  text: string;
  attachments?: AttachmentRef[];
  state: "sending" | "offline" | "steering" | "queued";
  /** Echoes: when it was sent (browser clock). */
  createdAt?: number;
  /** Held items in a shared chat: who sent it. */
  author?: ChatAuthor;
}

/** An outbox entry still drawn as its Echo in the transcript (not yet held by the server). */
export function isEcho(entry: OutboxEntry): boolean {
  return entry.state === "sending" || entry.state === "offline";
}

/**
 * The bot is working with nothing on screen to show it: waiting on the
 * first token, or between tool rounds. A streaming reply, a running tool
 * row or an approval card already says so on its own.
 */
function awaitingFirstOutput(messages: ChatMessage[]): boolean {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "assistant") return true;
  if (last.status === "streaming") return false;
  return !last.toolCalls?.some(isActive);
}

/** The chat, ready to render. */
export interface ChatView {
  /** The transcript loaded so far (the live views read what the bot is doing from it). */
  messages: ChatMessage[];
  /** Messages and routine cards by time, then the Echoes. */
  timeline: TimelineItem[];
  /** Owner messages the transcript does not hold yet: Echoes first sent, then held items. */
  outbox: OutboxEntry[];
  busy: boolean;
  /** Show the typing dots: the bot works with nothing on screen to show it. */
  typing: boolean;
  /** `loading` until the visit's first snapshot; `reconnecting` while the stream is down after. */
  health: "loading" | "live" | "reconnecting";
  hasMore: boolean;
  loadingOlder: boolean;
  /** The message the "New messages" divider goes above, if any. */
  unreadDividerId: string | null;
  /** Whether transcript message `index` was read before this visit (the scroller's anchors). */
  isRead: (index: number) => boolean;
  yolo: boolean;
}

/** Derive what the chat pane shows from the session. */
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
    ...echoed.map((echo) => ({ kind: "echo" as const, echo, at: echo.createdAt ?? 0 })),
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
