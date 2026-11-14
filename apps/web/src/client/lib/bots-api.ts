/**
 * Typed client for the bots API (PRD §9). The shapes are the server's own,
 * declared once in `shared/api/` (bots, memories, uploads, live, models) and
 * the agent package's chat types; dates arrive as ISO strings. `apiClient`
 * unwraps the { success, data } envelope.
 */
import { apiClient } from "@groot/shell/lib/api";
import type {
  AnswerQuestionsBody,
  ApprovalBody,
  Bot,
  BotCreateBody,
  BotListEntry,
  BotUpdateBody,
  CapabilityInfo,
  CapabilityList,
  ClaudeCodeAccount,
  ClaudeCodeStatus,
  HistoryPage,
  PastChatList,
  PastChatView,
  PinBody,
  SendMessageBody,
  YoloBody,
  YoloState,
} from "../../shared/api/bots";
import type { Deleted } from "../../shared/api/common";
import type {
  BrowserStatus,
  ComputerStatus,
  DriverBody,
  LiveStarting,
  ResizeBody,
  VncTicket,
} from "../../shared/api/live";
import type {
  MemoryCategory,
  MemoryCreateBody,
  MemoryList,
  MemoryResult,
  MemoryUpdateBody,
} from "../../shared/api/memories";
import type { ModelsResponse } from "../../shared/api/models";
import type { StoredUpload, UploadStatus, UploadText } from "../../shared/api/uploads";
import type { OwnerAnswer } from "./chat-types";

export const claudeCodeApi = {
  status: () => apiClient.get<ClaudeCodeStatus>("/claude-code/status"),
  account: () => apiClient.get<ClaudeCodeAccount>("/claude-code/account"),
};

/** Category display order, the same order the injected block renders in. */
export const CATEGORY_ORDER: readonly MemoryCategory[] = ["preference", "fact", "goal", "habit"];

// Capabilities are static per server boot, and every chat/dialog mount asks
// for them, so memoize the promise: one request serves the whole session
// (a page reload picks up a restarted server). A rejection clears the cache
// so the next call retries instead of failing forever.
let capabilitiesCache: Promise<CapabilityInfo[]> | null = null;

/**
 * The route returns `{ capabilities }`; unwrap here so callers get the
 * array (a raw `.get<CapabilityInfo[]>()` would hand them the wrapper
 * object and crash on the first `.filter`/`.flatMap`).
 */
async function fetchCapabilities(): Promise<CapabilityInfo[]> {
  try {
    return (await apiClient.get<CapabilityList>("/capabilities")).capabilities ?? [];
  } catch (error) {
    capabilitiesCache = null;
    throw error;
  }
}

export const botsApi = {
  list: () => apiClient.get<BotListEntry[]>("/bots"),
  create: (input: BotCreateBody) => apiClient.post<Bot>("/bots", input),
  get: (id: string) => apiClient.get<Bot>(`/bots/${id}`),
  /** Older messages, just before message `before` (issue #92). */
  history: (id: string, before: string, limit = 50) =>
    apiClient.get<HistoryPage>(`/bots/${id}/messages`, {
      before,
      limit,
    }),
  update: (id: string, input: BotUpdateBody) => apiClient.patch<Bot>(`/bots/${id}`, input),
  remove: (id: string) => apiClient.delete<Bot>(`/bots/${id}`),
  models: () => apiClient.get<ModelsResponse>("/models"),
  send: (
    id: string,
    requestId: string,
    text: string,
    mentions?: string[],
    attachments?: string[],
    whenBusy?: "steer" | "followUp",
  ) =>
    apiClient.post(`/bots/${id}/messages`, {
      requestId,
      text,
      ...(mentions?.length ? { mentions } : {}),
      ...(attachments?.length ? { attachments } : {}),
      ...(whenBusy ? { whenBusy } : {}),
    } satisfies SendMessageBody),
  /** Withdraw a queued message (the x on a queued/steering bubble). */
  withdraw: (id: string, requestId: string) =>
    apiClient.delete(`/bots/${id}/messages/${encodeURIComponent(requestId)}`),
  upload: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return apiClient.postForm<StoredUpload>("/uploads", form);
  },
  uploadUrl: (uploadId: string) => `/api/v1/uploads/${uploadId}/content`,
  uploadStatus: (uploadId: string) => apiClient.get<UploadStatus>(`/uploads/${uploadId}`),
  uploadText: (uploadId: string, params: { page?: number; sheet?: number } = {}) =>
    apiClient.get<UploadText>(`/uploads/${uploadId}/text`, params),
  deleteUpload: (uploadId: string) => apiClient.delete<Deleted>(`/uploads/${uploadId}`),
  abort: (id: string) => apiClient.post(`/bots/${id}/abort`),
  reset: (id: string) => apiClient.post<Bot>(`/bots/${id}/reset`),
  pastChats: (id: string) => apiClient.get<PastChatList>(`/bots/${id}/chats`).then((r) => r.chats),
  pastChat: (id: string, chatId: string) =>
    apiClient.get<PastChatView>(`/bots/${id}/chats/${chatId}`),
  /** Older messages of a past chat, just before message `before`. */
  pastChatHistory: (id: string, chatId: string, before: string, limit = 50) =>
    apiClient.get<HistoryPage>(`/bots/${id}/chats/${chatId}/messages`, { before, limit }),
  /** Move the bot back onto a past chat; the chat it was on becomes a past chat. */
  continuePastChat: (id: string, chatId: string) =>
    apiClient.post<Bot>(`/bots/${id}/chats/${chatId}/continue`),
  deletePastChat: (id: string, chatId: string) =>
    apiClient.delete<Deleted>(`/bots/${id}/chats/${chatId}`),
  read: (id: string) => apiClient.post<Bot>(`/bots/${id}/read`),
  pin: (id: string, pinned: boolean) =>
    apiClient.post<Bot>(`/bots/${id}/pin`, { pinned } satisfies PinBody),
  /** YOLO mode for the bot's current chat (issue #151): owner only. */
  setYolo: (id: string, on: boolean) =>
    apiClient.put<YoloState>(`/bots/${id}/yolo`, { on } satisfies YoloBody),
  capabilities: () => (capabilitiesCache ??= fetchCapabilities()),
  decideApproval: (
    id: string,
    taskId: number,
    decision: "approved" | "denied",
    alwaysAllow?: string,
    /** Vault cards: approve this handle for the rest of the conversation. */
    grant?: boolean,
  ) =>
    apiClient.post(`/bots/${id}/approvals/${taskId}`, {
      decision,
      ...(alwaysAllow ? { alwaysAllow } : {}),
      ...(grant ? { grant } : {}),
    } satisfies ApprovalBody),
  /** Answer a bot's questions (one answer per question), or dismiss them with `null`. */
  answerQuestions: (id: string, taskId: number, answers: OwnerAnswer[] | null) =>
    apiClient.post(
      `/bots/${id}/questions/${taskId}`,
      (answers ? { answers } : { dismissed: true }) satisfies AnswerQuestionsBody,
    ),
  browserStatus: (id: string) => apiClient.get<BrowserStatus>(`/bots/${id}/browser`),
  browserDriver: (id: string, driver: DriverBody["driver"]) =>
    apiClient.post(`/bots/${id}/browser/driver`, { driver } satisfies DriverBody),
  browserStart: (id: string) => apiClient.post<LiveStarting>(`/bots/${id}/browser/start`),
  browserVncTicket: (id: string) => apiClient.post<VncTicket>(`/bots/${id}/browser/vnc-ticket`),
  browserResize: (id: string, size: ResizeBody) =>
    apiClient.post(`/bots/${id}/browser/resize`, size),
  browserResetProfile: (id: string) => apiClient.delete(`/bots/${id}/browser/profile`),
  computerStatus: (id: string) => apiClient.get<ComputerStatus>(`/bots/${id}/computer`),
  computerDriver: (id: string, driver: DriverBody["driver"]) =>
    apiClient.post(`/bots/${id}/computer/driver`, { driver } satisfies DriverBody),
  computerStart: (id: string) => apiClient.post<LiveStarting>(`/bots/${id}/computer/start`),
  computerVncTicket: (id: string) => apiClient.post<VncTicket>(`/bots/${id}/computer/vnc-ticket`),
  computerReset: (id: string) => apiClient.delete(`/bots/${id}/computer/profile`),
  listMemories: (id: string, includeArchived = true) =>
    apiClient.get<MemoryList>(`/bots/${id}/memories`, { includeArchived }),
  createMemory: (id: string, input: MemoryCreateBody) =>
    apiClient.post<MemoryResult>(`/bots/${id}/memories`, input),
  updateMemory: (id: string, input: MemoryUpdateBody) =>
    apiClient.patch<MemoryResult>(`/memories/${id}`, input),
  deleteMemory: (id: string) => apiClient.delete<Deleted>(`/memories/${id}`),
};
