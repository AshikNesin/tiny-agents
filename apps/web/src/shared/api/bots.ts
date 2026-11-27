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

export type BotListEntry = Jsonified<BotListEntryData>;

export interface BotData {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  modelId: string | null;
  conversationId: string;
  chatStartedAt: Date;
  lastReadAt: Date | null;
  lastActivityAt: Date;
  lastMessagePreview: string | null;
  memoryEnabled: boolean;
  autoReview: boolean;
  yoloByDefault: boolean;
  memoryCapturedThrough: Date | null;
  pinnedAt: Date | null;
  browserProfile: BrowserProfile;
  projectId: string | null;
  createdAt: Date;
  updatedAt: Date;
  toolPermissions: Record<string, ToolPermission>;
  skillIds: string[];
  connectionIds: string[];
  connectionCapabilities: string[];
  guestIds: number[];
}

export type Bot = Jsonified<BotData>;

export interface BotCreateBody {
  name: string;
  description?: string;
  systemPrompt?: string;
  modelId: string;
  toolPermissions?: Record<string, ToolPermission>;
  skillIds?: string[];
  connectionIds?: string[];
  guestIds?: number[];
  memoryEnabled?: boolean;
  autoReview?: boolean;
  yoloByDefault?: boolean;
  browserProfile?: BrowserProfile;
}

export type BotUpdateBody = Partial<BotCreateBody>;

export type CapabilityInfo = Omit<Capability, "extension">;

export interface CapabilityList {
  capabilities: CapabilityInfo[];
}

export interface ClaudeCodeStatus {
  enabled: boolean;
  fallback: "gateway" | "pause";
  configured: boolean;
  mode: "sandbox" | "none";
  workerHost?: string;
}

export type ClaudeCodeAccount =
  | { state: "unconfigured" }
  | { state: "installing" }
  | { state: "error"; detail: string }
  | { state: "ready"; loggedIn: boolean; subscription: boolean; plan?: string; detail?: string };

export interface SendMessageBody {
  requestId: string;
  text: string;
  mentions?: string[];
  attachments?: string[];
  whenBusy?: "steer" | "followUp";
}

export interface ApprovalBody {
  decision: "approved" | "denied";
  alwaysAllow?: string;
  everyBot?: boolean;
  grant?: boolean;
}

export type AnswerQuestionsBody = { answers: OwnerAnswer[] } | { dismissed: true };

export interface PinBody {
  pinned: boolean;
}

export interface YoloBody {
  on: boolean;
}

export interface YoloState {
  on: boolean;
  approved: number[];
}

export type HistoryPage = ChatPage;

export interface PastChatData {
  id: string;
  title: string | null;
  startedAt: Date;
  endedAt: Date;
  lastMessagePreview: string | null;
  messageCount: number;
}

export type PastChat = Jsonified<PastChatData>;

export interface PastChatListData {
  chats: PastChatData[];
}

export type PastChatList = Jsonified<PastChatListData>;

export interface PastChatViewData {
  chat: PastChatData;
  state: ChatState;
  runs: RoutineRunCard[];
}

export type PastChatView = Jsonified<PastChatViewData>;

export interface ToolPermissionsData {
  permissions: Record<string, ToolPermission>;
}
