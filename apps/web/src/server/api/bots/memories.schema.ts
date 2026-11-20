import { z } from "zod";
import { memoryCategorySchema, memoryTextSchema } from "./memories.domain";

export const listMemoriesSchema = z.object({
  includeArchived: z.stringbool().optional().default(false),
});

export const createMemorySchema = z.object({
  text: memoryTextSchema,
  category: memoryCategorySchema,
  until: z.string().datetime().nullable().optional(),
});

export const updateMemorySchema = z
  .object({
    text: memoryTextSchema.optional(),
    category: memoryCategorySchema.optional(),
    until: z.string().datetime().nullable().optional(),
    restore: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "No fields to update" });

export type CreateMemoryDTO = z.infer<typeof createMemorySchema>;
export type UpdateMemoryDTO = z.infer<typeof updateMemorySchema>;
