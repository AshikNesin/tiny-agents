export interface ChatMode {
  ownerActions: boolean;
  openAt: "last-anchor" | "end";
  autoScroll: boolean;
  scrollAnchors: boolean;
  unreadDivider: boolean;
  emptyState: boolean;
  typing: boolean;
  streamHealth: boolean;
  loadingSpinner: "settled" | "immediate";
  contentTestId?: string;
}

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
