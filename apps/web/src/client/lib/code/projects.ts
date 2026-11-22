import type { WorkflowName } from "../../../shared/code-status";
import { apiClient } from "@groot/shell/lib/api";
import { useResource } from "../../queries/resource";
import type {
  CheckLogView,
  CheckpointView,
  GitHubStatus,
  MergeMethod,
  ProjectCreateBody,
  ProjectUpdateBody,
  ProjectView,
  InboxPullView,
  PullReviewView,
  PullThreadsView,
  AskReviewBody,
  EditReviewFileBody,
  PushedReview,
  ReviewTerminal,
  WorktreeFile,
  FindingView,
  FileHit,
  SuggestedChanges,
  ReviewDraft,
  ReviewDraftBody,
  ReviewFile,
  ReviewFileDiff,
  SubmitReviewBody,
  ThreadPullsView,
} from "../../../shared/api/code";

const base = "/code";
const thread = (id: string) => `${base}/threads/${encodeURIComponent(id)}`;

const scoped = (scope: string) => (scope === "base" ? undefined : { scope });
const targeted = (target?: "github") => (target ? `?target=${target}` : "");

export const projectsApi = {
  github: () => apiClient.get<GitHubStatus>(`${base}/github`),
  setToken: (token: string | null) => apiClient.put<GitHubStatus>(`${base}/github`, { token }),
  createApp: (organization?: string) =>
    apiClient.post<{ url: string; manifest: object; webhooks: boolean }>(
      `${base}/github/app/manifest`,
      organization ? { organization } : {},
    ),
  installApp: () => apiClient.post<{ url: string }>(`${base}/github/app/install`),
  appRepositories: () =>
    apiClient.get<Array<{ fullName: string; installationId: number; private: boolean }>>(
      `${base}/github/app/repositories`,
    ),
  disconnectApp: () => apiClient.delete<GitHubStatus>(`${base}/github/app`),

  list: () => apiClient.get<ProjectView[]>(`${base}/projects`),
  create: (body: ProjectCreateBody) => apiClient.post<ProjectView>(`${base}/projects`, body),
  update: (id: string, body: ProjectUpdateBody) =>
    apiClient.patch<ProjectView>(`${base}/projects/${encodeURIComponent(id)}`, body),
  remove: (id: string) => apiClient.delete(`${base}/projects/${encodeURIComponent(id)}`),

  pulls: (id: string, fresh = true) =>
    apiClient.get<ThreadPullsView>(`${thread(id)}/pr`, fresh ? {} : { fresh: "false" }),
  checkLog: (id: string, jobId: number) =>
    apiClient.get<CheckLogView>(`${thread(id)}/pr/checks/${jobId}/log`),
  publish: (id: string, body: { title?: string; body?: string } = {}) =>
    apiClient.post<ThreadPullsView>(`${thread(id)}/publish`, body),
  link: (id: string, number: number) =>
    apiClient.post<ThreadPullsView>(`${thread(id)}/pr/link`, { number }),
  unlink: (id: string) => apiClient.post<ThreadPullsView>(`${thread(id)}/pr/unlink`),
  autofix: (id: string, enabled: boolean) =>
    apiClient.post<ThreadPullsView>(`${thread(id)}/pr/autofix`, { enabled }),
  runWorkflow: (id: string, name: WorkflowName) =>
    apiClient.post<{ started: boolean; reason?: string; view: ThreadPullsView }>(
      `${thread(id)}/workflows/${name}`,
    ),
  checkpoints: (id: string) => apiClient.get<CheckpointView[]>(`${thread(id)}/checkpoints`),
  revert: (id: string, cp: string) =>
    apiClient.post<{ reverted: boolean }>(
      `${thread(id)}/checkpoints/${encodeURIComponent(cp)}/revert`,
    ),
  editPull: (id: string, change: { title?: string; body?: string }) =>
    apiClient.patch<ThreadPullsView>(`${thread(id)}/pr`, change),
  setDraft: (id: string, draft: boolean) =>
    apiClient.post<ThreadPullsView>(`${thread(id)}/pr/draft`, { draft }),
  merge: (id: string, method: MergeMethod) =>
    apiClient.post<ThreadPullsView>(`${thread(id)}/pr/merge`, { method }),

  reviewFiles: (id: string, scope = "base") =>
    apiClient.get<ReviewFile[]>(`${thread(id)}/review/files`, scoped(scope)),
  reviewFile: (id: string, path: string, scope = "base") =>
    apiClient.get<ReviewFileDiff>(`${thread(id)}/review/file`, { path, ...scoped(scope) }),
  editFile: (id: string, body: EditReviewFileBody) =>
    apiClient.put(`${thread(id)}/review/file`, body),
  files: (id: string) => apiClient.get<string[]>(`${thread(id)}/files`),
  fileContent: (id: string, path: string) =>
    apiClient.get<WorktreeFile>(`${thread(id)}/files/content`, { path }),
  searchFiles: (id: string, q: string) =>
    apiClient.get<FileHit[]>(`${thread(id)}/files/search`, { q }),
  terminal: (id: string) => apiClient.post<ReviewTerminal>(`${thread(id)}/terminal`),
  setViewed: (id: string, path: string, hash: string, viewed: boolean) =>
    apiClient.post(`${thread(id)}/review/viewed`, { path, hash, viewed }),
  drafts: (id: string, target?: "github") =>
    apiClient.get<ReviewDraft[]>(`${thread(id)}/review/drafts${targeted(target)}`),
  addDraft: (id: string, body: ReviewDraftBody, target?: "github") =>
    apiClient.post<ReviewDraft>(`${thread(id)}/review/drafts${targeted(target)}`, body),
  removeDraft: (id: string, draftId: string, target?: "github") =>
    apiClient.delete(
      `${thread(id)}/review/drafts/${encodeURIComponent(draftId)}${targeted(target)}`,
    ),
  sendDrafts: (id: string) => apiClient.post<{ sent: number }>(`${thread(id)}/review/send`),
};

export const reviewsApi = {
  list: () => apiClient.get<PullReviewView[]>(`${base}/reviews`),
  inbox: (filter: Record<string, string> = {}) =>
    apiClient.get<InboxPullView[]>(`${base}/reviews/inbox`, filter),
  open: (pr: string) => apiClient.post<PullReviewView>(`${base}/reviews`, { pr }),
  get: (id: string) => apiClient.get<PullReviewView>(`${base}/reviews/${encodeURIComponent(id)}`),
  ask: (id: string, body: AskReviewBody) =>
    apiClient.post<{ threadId: string }>(`${base}/reviews/${encodeURIComponent(id)}/ask`, body),
  archive: (id: string) => apiClient.post(`${base}/reviews/${encodeURIComponent(id)}/archive`),
  agentReview: (id: string) =>
    apiClient.post<{ threadId: string }>(`${base}/reviews/${encodeURIComponent(id)}/agent-review`),
  decideFinding: (
    id: string,
    findingId: string,
    decision: { action: "add"; body?: string } | { action: "dismiss" },
  ) =>
    apiClient.post<FindingView[]>(
      `${base}/reviews/${encodeURIComponent(id)}/findings/${encodeURIComponent(findingId)}`,
      decision,
    ),
  submit: (id: string, body: SubmitReviewBody) =>
    apiClient.post<{ url: string; comments: number }>(
      `${base}/reviews/${encodeURIComponent(id)}/submit`,
      body,
    ),
  threads: (id: string) =>
    apiClient.get<PullThreadsView>(`${base}/reviews/${encodeURIComponent(id)}/threads`),
  reply: (id: string, threadId: string, body: string) =>
    apiClient.post(
      `${base}/reviews/${encodeURIComponent(id)}/threads/${encodeURIComponent(threadId)}/reply`,
      { body },
    ),
  resolve: (id: string, threadId: string) =>
    apiClient.post(
      `${base}/reviews/${encodeURIComponent(id)}/threads/${encodeURIComponent(threadId)}/resolve`,
    ),
  toThread: (id: string) =>
    apiClient.post<{ threadId: string; sent: number }>(
      `${base}/reviews/${encodeURIComponent(id)}/comments/to-thread`,
    ),
  push: (id: string, message: string) =>
    apiClient.post<PushedReview>(`${base}/reviews/${encodeURIComponent(id)}/push`, { message }),
  suggest: (id: string) =>
    apiClient.post<SuggestedChanges>(`${base}/reviews/${encodeURIComponent(id)}/suggestions`),
  discard: (id: string) => apiClient.post(`${base}/reviews/${encodeURIComponent(id)}/discard`),
  terminal: (id: string) =>
    apiClient.post<ReviewTerminal>(`${base}/reviews/${encodeURIComponent(id)}/terminal`),
};

export const reviewPath = (id: string) => `/code/reviews/${encodeURIComponent(id)}`;

export function useProjects(): {
  projects: ProjectView[] | null;
  reload(): void;
} {
  const { data, refresh } = useResource(
    ["code", "projects"],
    () => projectsApi.list().catch(() => null),
    "",
  );
  return { projects: data, reload: refresh };
}
