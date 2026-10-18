/** Typed client for the skills API (issue #1 M2). */
import { apiClient } from "@groot/shell/lib/api";

export interface SkillFile {
  path: string;
  content: string;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  body: string;
  files: SkillFile[];
  source: string;
  sourceUrl: string | null;
  botIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SkillPreview {
  name: string;
  description: string;
  body: string;
  files: SkillFile[];
  sourceUrl?: string;
  warnings: string[];
  exists: boolean;
}

export type SkillSummary = Pick<Skill, "id" | "name" | "description">;

export const skillsApi = {
  list: () => apiClient.get<Skill[]>("/skills"),
  get: (id: string) => apiClient.get<Skill>(`/skills/${id}`),
  create: (input: Partial<Skill> & { name: string; description: string }) =>
    apiClient.post<Skill>("/skills", input),
  update: (id: string, input: Partial<Skill>) => apiClient.patch<Skill>(`/skills/${id}`, input),
  remove: (id: string) => apiClient.delete(`/skills/${id}`),
  preview: (input: { source: "paste"; content: string } | { source: "github"; url: string }) =>
    apiClient.post<SkillPreview>("/skills/preview", input),
};
