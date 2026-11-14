/**
 * The Bots API's wire types (`server/api/bots`): bots, their chats and past
 * chats, capabilities and the Claude plan's status. Naming in `./common.ts`.
 * The chat's own shapes (messages, pages, stream events) are the agent
 * package's and `shared/bot-stream.ts`'s.
 */
import type {
  Capability,
  ChatPage,
  ChatState,
  OwnerAnswer,
  ToolPermission,
} from "@tiny-agents/agent";
import type { BotListEntry as BotListEntryData } from "../bot-list";
import type { RoutineRunCard } from "../bot-stream";
import type { Jsonified } from "../json";
import type { BrowserProfile } from "./live";

export type { ToolPermission };

/** One bot as the sidebar lists it (GLOSSARY: Bot list), dates as ISO strings. */
export type BotListEntry = Jsonified<BotListEntryData>;

/** A bot as the routes return it (`bots.conversation.ts` `toBot`). */
export interface BotData {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  /** Null: the bot runs on the `bot_default` model role. */
  modelId: string | null;
  conversationId: string;
  /** When the current chat conversation started; routine cards older than it stay out. */
  chatStartedAt: Date;
  lastReadAt: Date | null;
  lastActivityAt: Date;
  lastMessagePreview: string | null;
  /** Memory capture + injection switch (issue #22). */
  memoryEnabled: boolean;
  /** Auto-review (issue #65): a classifier may approve "ask" tool calls. */
  autoReview: boolean;
  /** Every new chat starts with YOLO mode on (issue #151). */
  yoloByDefault: boolean;
  /** Transcript watermark: owner turns captured through this instant. */
  memoryCapturedThrough: Date | null;
  /** Set while the bot is pinned to the top of the sidebar. */
  pinnedAt: Date | null;
  /** `shared`: the browser (and logins) every such bot uses; `own`: a browser of its own. */
  browserProfile: BrowserProfile;
  createdAt: Date;
  updatedAt: Date;
  /** Tool name → permission; tools without an entry use their default. */
  toolPermissions: Record<string, ToolPermission>;
  skillIds: string[];
  connectionIds: string[];
  /** Capability ids of the bot's connections (`mcp:<slug>`). */
  connectionCapabilities: string[];
  /** Guests the bot is shared with (issue #145): they are in its chat. */
  guestIds: number[];
}

export type Bot = Jsonified<BotData>;

/** `POST /bots`. */
export interface BotCreateBody {
  name: string;
  description?: string;
  systemPrompt?: string;
  modelId: string;
  toolPermissions?: Record<string, ToolPermission>;
  skillIds?: string[];
  connectionIds?: string[];
  /** Guests to share the bot with; on update, replaces the current list. */
  guestIds?: number[];
  memoryEnabled?: boolean;
  autoReview?: boolean;
  yoloByDefault?: boolean;
  browserProfile?: BrowserProfile;
}

/** `PATCH /bots/:id`. */
export type BotUpdateBody = Partial<BotCreateBody>;

/** A toolkit, the skills library or a connection, as bots' settings list it. */
export type CapabilityInfo = Omit<Capability, "extension">;

/** `GET /capabilities`. */
export interface CapabilityList {
  capabilities: CapabilityInfo[];
}

/** `GET /claude-code/status`: the Claude plan engine. Never a credential or the worker token. */
export interface ClaudeCodeStatus {
  enabled: boolean;
  fallback: "gateway" | "pause";
  configured: boolean;
  /** `sandbox`: the app runs the worker on the sandbox. `none`: no sandbox configured. */
  mode: "sandbox" | "none";
  workerHost?: string;
}

/** `GET /claude-code/account`: whether Claude Code is installed and signed in. Never a credential. */
export type ClaudeCodeAccount =
  | { state: "unconfigured" }
  | { state: "installing" }
  | { state: "error"; detail: string }
  | { state: "ready"; loggedIn: boolean; subscription: boolean; plan?: string; detail?: string };

/** `POST /bots/:id/messages`. */
export interface SendMessageBody {
  /** The client's id for the message; a retry with the same id is the same message. */
  requestId: string;
  text: string;
  /** Bot ids the text @mentions; the server delivers copies to each. */
  mentions?: string[];
  /** Upload ids attached to this message (issue #17). */
  attachments?: string[];
  /** Placement while a reply runs (default `followUp`). */
  whenBusy?: "steer" | "followUp";
}

/** `POST /bots/:id/approvals/:taskId`. */
export interface ApprovalBody {
  decision: "approved" | "denied";
  /** Tool name to switch to `allow` for this bot along with approving. */
  alwaysAllow?: string;
  /** Vault approvals: approve this handle for the rest of the conversation. */
  grant?: boolean;
}

/** `POST /bots/:id/questions/:taskId`: one answer per question, or the dismissal. */
export type AnswerQuestionsBody = { answers: OwnerAnswer[] } | { dismissed: true };

/** `POST /bots/:id/pin`. */
export interface PinBody {
  pinned: boolean;
}

/** `PUT /bots/:id/yolo`. */
export interface YoloBody {
  on: boolean;
}

/** `PUT /bots/:id/yolo`: the new state, and the waiting cards it approved. */
export interface YoloState {
  on: boolean;
  approved: number[];
}

/** `GET /bots/:id/messages` and a past chat's `…/messages`: older messages. */
export type HistoryPage = ChatPage;

/** A conversation the bot ran on before a "New chat" (issue #101). */
export interface PastChatData {
  id: string;
  /** Model-written title; the first owner message until it arrives. */
  title: string | null;
  startedAt: Date;
  endedAt: Date;
  lastMessagePreview: string | null;
  messageCount: number;
}

export type PastChat = Jsonified<PastChatData>;

/** `GET /bots/:id/chats`. */
export interface PastChatListData {
  chats: PastChatData[];
}

export type PastChatList = Jsonified<PastChatListData>;

/** `GET /bots/:id/chats/:chatId`: its newest messages (older ones page in) and its routine cards. */
export interface PastChatViewData {
  chat: PastChatData;
  /** The chat windowed like the live stream's snapshot. */
  state: ChatState;
  runs: RoutineRunCard[];
}

export type PastChatView = Jsonified<PastChatViewData>;
