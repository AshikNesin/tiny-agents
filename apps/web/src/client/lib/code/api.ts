import { apiClient } from "@groot/shell/lib/api";
import type {
  Capabilities,
  CodeListEvent,
  CodeThreadEvent,
  FileMatch,
  InstanceStatus,
  ModelOption,
  PermissionMode,
  RecoveryAction,
  RequestAnswer,
  Skill,
  SlashCommand,
  ThreadSettings,
  ThreadSnapshot,
  ThreadSummary,
} from "@tiny-agents/code/contracts";

export type * from "@tiny-agents/code/contracts";
export type { CodeListEvent, CodeThreadEvent };

export interface HarnessInfo {
  id: string;
  kind: string;
  label: string;
  status: InstanceStatus;
  capabilities: Capabilities;
  commands: SlashCommand[];
}

const base = "/code";
const thread = (id: string) => `${base}/threads/${encodeURIComponent(id)}`;
const harness = (instanceId: string) => `${base}/harnesses/${encodeURIComponent(instanceId)}`;

export const codeApi = {
  status: () => apiClient.get<{ harnesses: HarnessInfo[] }>(`${base}/status`),
  eventsPath: () => `/api/v1${base}/events`,
  threadEventsPath: (id: string) => `/api/v1${thread(id)}/events`,
  threadChangesPath: (id: string) => `/api/v1${thread(id)}/changes`,

  list: (view: "active" | "archived" = "active") =>
    apiClient.get<ThreadSummary[]>(`${base}/threads`, { view }),
  get: (id: string) => apiClient.get<ThreadSnapshot>(thread(id)),
  markSeen: (id: string, cursor: number) => apiClient.post(`${thread(id)}/seen`, { cursor }),

  create: (input: {
    projectId: string;
    message: string;
    instanceId?: string;
    model?: string;
    effort?: string;
    permissionMode?: PermissionMode;
    attachments?: string[];
  }) => apiClient.post<{ threadId: string }>(`${base}/threads`, input),
  send: (
    id: string,
    message: string,
    options: {
      queue?: boolean;
      skills?: string[];
      attachments?: string[];
      withReview?: boolean;
    } = {},
  ) =>
    apiClient.post<{ status: "accepted" | "queued" }>(`${thread(id)}/messages`, {
      message,
      ...options,
    }),
  interrupt: (id: string) => apiClient.post(`${thread(id)}/interrupt`),
  respond: (id: string, requestId: string, answer: RequestAnswer) =>
    apiClient.post(`${thread(id)}/requests/${encodeURIComponent(requestId)}`, answer),
  recover: (id: string, action: RecoveryAction) =>
    apiClient.post(`${thread(id)}/recover`, { action }),
  queued: (id: string, queuedId: string, action: "send" | "cancel") =>
    apiClient.post(`${thread(id)}/queued/${encodeURIComponent(queuedId)}/${action}`),
  killJob: (id: string, jobId: string) =>
    apiClient.post(`${thread(id)}/jobs/${encodeURIComponent(jobId)}/kill`),
  settings: (id: string, change: Partial<ThreadSettings>) =>
    apiClient.post<ThreadSettings>(`${thread(id)}/settings`, change),
  archive: (id: string, archived: boolean) =>
    apiClient.post<{ moved: string[] }>(`${thread(id)}/archive`, { archived }),
  remove: (id: string) => apiClient.delete(thread(id)),
  rewind: (id: string, body: { at: string; turn: number; turns: number; text: string }) =>
    apiClient.post<{ filesRestored: boolean; replaced: string }>(`${thread(id)}/rewind`, body),
  undoRewind: (id: string, replaced: string) =>
    apiClient.post(`${thread(id)}/rewind/undo`, { replaced }),
  rename: (id: string, title: string) => apiClient.post(`${thread(id)}/rename`, { title }),

  models: (instanceId: string) => apiClient.get<ModelOption[]>(`${harness(instanceId)}/models`),
  skills: (instanceId: string, cwd: string, threadId?: string) =>
    apiClient.get<Skill[]>(`${harness(instanceId)}/skills`, { cwd, threadId }),
  findFiles: (instanceId: string, dir: string, q: string, content?: "only") =>
    apiClient.get<FileMatch[]>(`${harness(instanceId)}/find-files`, { dir, q, content }),

  assetUrl: (instanceId: string, ref: string) =>
    `/api/v1${harness(instanceId)}/asset?ref=${encodeURIComponent(ref)}`,

  async upload(instanceId: string, file: File): Promise<string> {
    const response = await fetch(
      `/api/v1${base}/uploads/${encodeURIComponent(instanceId)}?filename=${encodeURIComponent(file.name || "pasted")}`,
      {
        method: "POST",
        credentials: "include",
        headers: { "content-type": file.type || "application/octet-stream" },
        body: file,
      },
    );
    const envelope = (await response.json().catch(() => ({}))) as {
      data?: { ref?: string };
      error?: { message?: string };
    };
    if (!response.ok || !envelope.data?.ref) {
      throw new Error(envelope.error?.message ?? `Upload failed (${response.status})`);
    }
    return envelope.data.ref;
  },
};

export function threadPath(id: string): string {
  return `/code/t/${encodeURIComponent(id)}`;
}

export function shortPath(path: string | null | undefined): string {
  if (!path) return "";
  const parts = path.split("/").filter(Boolean);
  return parts.length <= 2 ? path : `…/${parts.slice(-2).join("/")}`;
}
