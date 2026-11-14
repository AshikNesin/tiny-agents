/** Typed client for the skills API (issue #1 M2); the shapes are `shared/api/skills.ts`. */
import { apiClient } from "@groot/shell/lib/api";
import type { Deleted } from "../../shared/api/common";
import type {
  Skill,
  SkillCreateBody,
  SkillPreview,
  SkillPreviewBody,
  SkillUpdateBody,
} from "../../shared/api/skills";

export const skillsApi = {
  list: () => apiClient.get<Skill[]>("/skills"),
  get: (id: string) => apiClient.get<Skill>(`/skills/${id}`),
  create: (input: SkillCreateBody) => apiClient.post<Skill>("/skills", input),
  update: (id: string, input: SkillUpdateBody) => apiClient.patch<Skill>(`/skills/${id}`, input),
  remove: (id: string) => apiClient.delete<Deleted>(`/skills/${id}`),
  preview: (input: SkillPreviewBody) => apiClient.post<SkillPreview>("/skills/preview", input),
};
