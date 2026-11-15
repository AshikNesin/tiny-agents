/**
 * Code projects, pull requests and review on the client (issue #297): the
 * calls to `server/api/code/code.projects.routes.ts`. Wire types live in
 * `shared/api/code.ts`.
 */
import { useCallback, useEffect, useState } from "react";
import { apiClient } from "@groot/shell/lib/api";
import type {
  GitHubStatus,
  MergeMethod,
  ProjectCreateBody,
  ProjectUpdateBody,
  ProjectView,
  ReviewDraft,
  ReviewDraftBody,
  ReviewFile,
  ThreadPullsView,
} from "../../../shared/api/code";

const base = "/code";
const thread = (id: string) => `${base}/threads/${encodeURIComponent(id)}`;

export const projectsApi = {
  github: () => apiClient.get<GitHubStatus>(`${base}/github`),
  setToken: (token: string | null) => apiClient.put<GitHubStatus>(`${base}/github`, { token }),

  list: () => apiClient.get<ProjectView[]>(`${base}/projects`),
  create: (body: ProjectCreateBody) => apiClient.post<ProjectView>(`${base}/projects`, body),
  update: (id: string, body: ProjectUpdateBody) =>
    apiClient.patch<ProjectView>(`${base}/projects/${encodeURIComponent(id)}`, body),
  remove: (id: string) => apiClient.delete(`${base}/projects/${encodeURIComponent(id)}`),

  pulls: (id: string, fresh = true) =>
    apiClient.get<ThreadPullsView>(`${thread(id)}/pr`, fresh ? {} : { fresh: "false" }),
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
  merge: (id: string, method: MergeMethod) =>
    apiClient.post<ThreadPullsView>(`${thread(id)}/pr/merge`, { method }),

  reviewFiles: (id: string) => apiClient.get<ReviewFile[]>(`${thread(id)}/review/files`),
  reviewFile: (id: string, path: string) =>
    apiClient.get<{ path: string; oldContent: string; newContent: string }>(
      `${thread(id)}/review/file`,
      { path },
    ),
  setViewed: (id: string, path: string, hash: string, viewed: boolean) =>
    apiClient.post(`${thread(id)}/review/viewed`, { path, hash, viewed }),
  drafts: (id: string) => apiClient.get<ReviewDraft[]>(`${thread(id)}/review/drafts`),
  addDraft: (id: string, body: ReviewDraftBody) =>
    apiClient.post<ReviewDraft>(`${thread(id)}/review/drafts`, body),
  removeDraft: (id: string, draftId: string) =>
    apiClient.delete(`${thread(id)}/review/drafts/${encodeURIComponent(draftId)}`),
  sendDrafts: (id: string) => apiClient.post<{ sent: number }>(`${thread(id)}/review/send`),
};

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
