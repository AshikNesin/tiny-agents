import { z } from "zod";
import {
  MAX_NAME_CHARS,
  MAX_PROGRESS_CHARS,
  MAX_PROMPT_CHARS,
  scheduleSchema,
} from "./routines.schedule";

export const createRoutineSchema = z.object({
  botId: z.string().min(1, "Bot is required"),
  name: z.string().trim().min(1, "Name is required").max(MAX_NAME_CHARS),
  prompt: z.string().trim().min(1, "Prompt is required").max(MAX_PROMPT_CHARS),
  schedule: scheduleSchema,
  enabled: z.boolean().optional().default(true),
});

export const updateRoutineSchema = z
  .object({
    botId: z.string().min(1).optional(),
    name: z.string().trim().min(1, "Name is required").max(MAX_NAME_CHARS).optional(),
    prompt: z.string().trim().min(1, "Prompt is required").max(MAX_PROMPT_CHARS).optional(),
    schedule: scheduleSchema.optional(),
    enabled: z.boolean().optional(),
    progress: z.string().max(MAX_PROGRESS_CHARS).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "No fields to update" });

export const listRunsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export type CreateRoutineDTO = z.infer<typeof createRoutineSchema>;
export type UpdateRoutineDTO = z.infer<typeof updateRoutineSchema>;
