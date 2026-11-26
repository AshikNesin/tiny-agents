import { z } from "zod";
import { SKILL_NAME } from "@tiny-agents/agent";
import { MAX_FILE_BYTES, MAX_FILES } from "./skills.parse";

const name = z
  .string()
  .trim()
  .max(64)
  .regex(SKILL_NAME, "Use lowercase letters, digits and hyphens");
const description = z.string().trim().min(1, "Description is required").max(1024);
const body = z.string().max(50_000, "Instructions are too long (max 50k characters)");
const files = z
  .array(z.object({ path: z.string().min(1).max(300), content: z.string().max(MAX_FILE_BYTES) }))
  .max(MAX_FILES);

export const createSkillSchema = z.object({
  name,
  description,
  body: body.default(""),
  files: files.optional().default([]),
  source: z.enum(["manual", "url"]).optional().default("manual"),
  sourceUrl: z.string().url().max(2000).optional(),
  allBots: z.boolean().optional(),
  botIds: z.array(z.string()).optional(),
});

export const updateSkillSchema = z.object({
  name: name.optional(),
  description: description.optional(),
  body: body.optional(),
  allBots: z.boolean().optional(),
  botIds: z.array(z.string()).optional(),
});

export const previewSkillSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("paste"), content: z.string().min(1).max(60_000) }),
  z.object({ source: z.literal("github"), url: z.string().min(1).max(2000) }),
]);

export type CreateSkillDTO = z.infer<typeof createSkillSchema>;
export type UpdateSkillDTO = z.infer<typeof updateSkillSchema>;
export type PreviewSkillDTO = z.infer<typeof previewSkillSchema>;
