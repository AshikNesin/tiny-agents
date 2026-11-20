/**
 * Code projects, pull requests and review on the client (issue #297): the
 * calls to `server/api/code/code.projects.routes.ts`. Wire types live in
 * `shared/api/code.ts`.
 */
import { useCallback, useEffect, useState } from "react";
import { apiClient } from "@groot/shell/lib/api";
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
  PushedReview,
  ReviewTerminal,
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

/** The base scope is the server's default, so it is left off the query. */
const scoped = (scope: string) => (scope === "base" ? undefined : { scope });

export const projectsApi = {
  github: () => apiClient.get<GitHubStatus>(`${base}/github`),
  setToken: (token: string | null) => apiClient.put<GitHubStatus>(`${base}/github`, { token }),
  /** Start the one-click App setup: the page posts `manifest` to `url` (GitHub). */
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
  fix: (id: string) =>
    apiClient.post<{ started: boolean; reason?: string; view: ThreadPullsView }>(
      `${thread(id)}/pr/fix`,
    ),
  autoMerge: (id: string, enabled: boolean) =>
    apiClient.post<ThreadPullsView>(`${thread(id)}/pr/automerge`, { enabled }),
  spendLimit: (id: string, limitUsd: number | null) =>
    apiClient.post<ThreadPullsView>(`${thread(id)}/spend-limit`, { limitUsd }),
  checkpoints: (id: string) => apiClient.get<CheckpointView[]>(`${thread(id)}/checkpoints`),
  revert: (id: string, cp: string) =>
    apiClient.post<{ reverted: boolean }>(
      `${thread(id)}/checkpoints/${encodeURIComponent(cp)}/revert`,
    ),
  editPull: (id: string, change: { title?: string; body?: string }) =>
    apiClient.patch<ThreadPullsView>(`${thread(id)}/pr`, change),
  /** Draft → ready for review. */
  ready: (id: string) => apiClient.post<ThreadPullsView>(`${thread(id)}/pr/ready`, {}),
  merge: (id: string, method: MergeMethod) =>
    apiClient.post<ThreadPullsView>(`${thread(id)}/pr/merge`, { method }),

  /**
   * What a Review panel reads: `base` (the default) since the merge base;
   * for a PR review `review` (since the owner's last review) or `mine` (the
   * owner's changes on its head); or a checkpoint id, what that turn changed.
   */
  reviewFiles: (id: string, scope = "base") =>
    apiClient.get<ReviewFile[]>(`${thread(id)}/review/files`, scoped(scope)),
  reviewFile: (id: string, path: string, scope = "base") =>
    apiClient.get<ReviewFileDiff>(`${thread(id)}/review/file`, { path, ...scoped(scope) }),
  setViewed: (id: string, path: string, hash: string, viewed: boolean) =>
    apiClient.post(`${thread(id)}/review/viewed`, { path, hash, viewed }),
  drafts: (id: string) => apiClient.get<ReviewDraft[]>(`${thread(id)}/review/drafts`),
  addDraft: (id: string, body: ReviewDraftBody) =>
    apiClient.post<ReviewDraft>(`${thread(id)}/review/drafts`, body),
  removeDraft: (id: string, draftId: string) =>
    apiClient.delete(`${thread(id)}/review/drafts/${encodeURIComponent(draftId)}`),
  sendDrafts: (id: string) => apiClient.post<{ sent: number }>(`${thread(id)}/review/send`),
};

/** PR reviews (issue #345): any PR of a project's repository, with an assistant scoped to it. */
export const reviewsApi = {
  list: () => apiClient.get<PullReviewView[]>(`${base}/reviews`),
  /** The owner's review inbox from GitHub, across every repository. */
  inbox: () => apiClient.get<InboxPullView[]>(`${base}/reviews/inbox`),
  /** Open (or reopen) a review: `pr` is the PR's URL or `owner/name#123`. */
  open: (pr: string) => apiClient.post<PullReviewView>(`${base}/reviews`, { pr }),
  get: (id: string) => apiClient.get<PullReviewView>(`${base}/reviews/${encodeURIComponent(id)}`),
  /** A question for the assistant: the first starts it, with the PR card and waiting comments. */
  ask: (id: string, message: string) =>
    apiClient.post<{ threadId: string }>(`${base}/reviews/${encodeURIComponent(id)}/ask`, {
      message,
    }),
  archive: (id: string) => apiClient.post(`${base}/reviews/${encodeURIComponent(id)}/archive`),
  /** Comments waiting for the review on GitHub. */
  comments: (id: string) =>
    apiClient.get<ReviewDraft[]>(`${base}/reviews/${encodeURIComponent(id)}/comments`),
  addComment: (id: string, body: ReviewDraftBody) =>
    apiClient.post<ReviewDraft>(`${base}/reviews/${encodeURIComponent(id)}/comments`, body),
  removeComment: (id: string, commentId: string) =>
    apiClient.delete(
      `${base}/reviews/${encodeURIComponent(id)}/comments/${encodeURIComponent(commentId)}`,
    ),
  /** Post the review on GitHub with every waiting comment. */
  submit: (id: string, body: SubmitReviewBody) =>
    apiClient.post<{ url: string; comments: number }>(
      `${base}/reviews/${encodeURIComponent(id)}/submit`,
      body,
    ),
  /** The PR's line conversations on GitHub. */
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
  /** Hand the waiting comments to the Code thread that opened the PR. */
  toThread: (id: string) =>
    apiClient.post<{ threadId: string; sent: number }>(
      `${base}/reviews/${encodeURIComponent(id)}/comments/to-thread`,
    ),
  /** Commit your changes in the review's checkout and push them to the PR's branch. */
  push: (id: string, message: string) =>
    apiClient.post<PushedReview>(`${base}/reviews/${encodeURIComponent(id)}/push`, { message }),
  /** Your changes as pending suggestion comments. */
  suggest: (id: string) =>
    apiClient.post<SuggestedChanges>(`${base}/reviews/${encodeURIComponent(id)}/suggestions`),
  discard: (id: string) => apiClient.post(`${base}/reviews/${encodeURIComponent(id)}/discard`),
  /** A Terminal tab in the review's checkout. */
  terminal: (id: string) =>
    apiClient.post<ReviewTerminal>(`${base}/reviews/${encodeURIComponent(id)}/terminal`),
};

/** The page of a review. */
export const reviewPath = (id: string) => `/code/reviews/${encodeURIComponent(id)}`;

/** The owner's projects; `null` while loading or when they are not the owner's to see. */
export function useProjects(): {
  projects: ProjectView[] | null;
  reload(): void;
} {
  const [projects, setProjects] = useState<ProjectView[] | null>(null);
  const reload = useCallback(() => {
    projectsApi
      .list()
      .then(setProjects)
      .catch(() => setProjects(null));
  }, []);
  useEffect(reload, [reload]);
  return { projects, reload };
}
