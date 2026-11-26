import type { Jsonified } from "../json";

export interface SkillFile {
  path: string;
  content: string;
}

export interface SkillData {
  id: string;
  name: string;
  description: string;
  body: string;
  files: SkillFile[];
  source: string;
  sourceUrl: string | null;
  allBots: boolean;
  botIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

export type Skill = Jsonified<SkillData>;

export type SkillSummary = Pick<Skill, "id" | "name" | "description">;

export interface ParsedSkill {
  name: string;
  description: string;
  body: string;
  files: SkillFile[];
  sourceUrl?: string;
  warnings: string[];
}

export type SkillPreview = ParsedSkill & { exists: boolean };

export type SkillPreviewBody =
  | { source: "paste"; content: string }
  | { source: "github"; url: string };

export interface SkillCreateBody {
  name: string;
  description: string;
  body?: string;
  files?: SkillFile[];
  source?: "manual" | "url";
  sourceUrl?: string;
  allBots?: boolean;
  botIds?: string[];
}

export interface SkillUpdateBody {
  name?: string;
  description?: string;
  body?: string;
  allBots?: boolean;
  botIds?: string[];
}
