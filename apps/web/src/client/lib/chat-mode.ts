/**
 * The two modes of a chat session (docs/rewrite/README.md §4.5): the bot's
 * live chat, and a past chat (issue #101) read back read-only. Both are the
 * same session (lib/chat-session.ts, held by store/chats.ts) rendered by the
 * same transcript (components/ChatSessionTranscript.tsx); every way the
 * transcript differs between them is one flag here, never inferred.
 *
 * Read-only is also in the handle: a past chat's (`usePastChat`) has no
 * send, stop, withdraw or YOLO switch, so it never holds an Echo or a
 * queued row of its own.
 */
export interface ChatMode {
  /**
   * The cards act through the owner's actions (approve, deny, answer,
   * fill, hand back). Off: what still waits shows "not answered", with no
   * card and no buttons.
   */
  ownerActions: boolean;
  /** Where the transcript opens: the newest read message, or the end. */
  openAt: "last-anchor" | "end";
  /** The newest message stays pinned while the reader is at the bottom. */
  autoScroll: boolean;
  /** Read messages anchor the opening position (until two frames after the first messages). */
  scrollAnchors: boolean;
  /** The "New messages" divider above the first reply that came while the owner was away. */
  unreadDivider: boolean;
  /** The bot's avatar, name and description (or "Say hi…") when there are no messages. */
  emptyState: boolean;
  /** The typing dots while the bot works with nothing on screen to show it. */
  typing: boolean;
  /** The "Reconnecting…" and offline pill over the transcript. */
  streamHealth: boolean;
  /**
   * The first load's spinner. `settled`: only over an empty transcript, after
   * 300 ms. `immediate`: from the start until the chat is read.
   */
  loadingSpinner: "settled" | "immediate";
  /** The transcript content's test id. */
  contentTestId?: string;
}

/** The bot's chat, live on its stream. */
export const LIVE_CHAT: ChatMode = {
  ownerActions: true,
  openAt: "last-anchor",
  autoScroll: true,
  scrollAnchors: true,
  unreadDivider: true,
  emptyState: true,
  typing: true,
  streamHealth: true,
  loadingSpinner: "settled",
};

/** A past chat: read once, nothing in it can be answered or sent. */
export const PAST_CHAT: ChatMode = {
  ownerActions: false,
  openAt: "end",
  autoScroll: false,
  scrollAnchors: false,
  unreadDivider: false,
  emptyState: false,
  typing: false,
  streamHealth: false,
  loadingSpinner: "immediate",
  contentTestId: "past-chat-transcript",
};
