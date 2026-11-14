/** The Skills API's wire types (`server/api/skills`); naming in `./common.ts`. */
import type { Jsonified } from "../json";

/** A bundled file, imported as text. */
export interface SkillFile {
  path: string;
  content: string;
}

/** A skill as the routes return it (`skills.service.ts`). */
export interface SkillData {
  id: string;
  name: string;
  description: string;
  body: string;
  files: SkillFile[];
  /** `manual` or `url`. */
  source: string;
  sourceUrl: string | null;
  botIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

export type Skill = Jsonified<SkillData>;

/** What the bot editor lists of a skill. */
export type SkillSummary = Pick<Skill, "id" | "name" | "description">;

/** A parsed SKILL.md, or a GitHub skill folder, before it is saved (`skills.parse.ts`). */
export interface ParsedSkill {
  name: string;
  description: string;
  body: string;
  files: SkillFile[];
  sourceUrl?: string;
  /** Things the owner should know before installing. */
  warnings: string[];
}

/** `POST /skills/preview`: the parsed skill, and whether its name is taken. */
export type SkillPreview = ParsedSkill & { exists: boolean };

/** `POST /skills/preview`. */
export type SkillPreviewBody =
  | { source: "paste"; content: string }
  | { source: "github"; url: string };

/** `POST /skills`. */
export interface SkillCreateBody {
  name: string;
  description: string;
  body?: string;
  files?: SkillFile[];
  source?: "manual" | "url";
  sourceUrl?: string;
  botIds?: string[];
}

/** `PATCH /skills/:id`. */
export interface SkillUpdateBody {
  name?: string;
  description?: string;
  body?: string;
  botIds?: string[];
}
