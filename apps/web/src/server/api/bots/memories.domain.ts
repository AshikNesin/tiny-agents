import { MEMORY_CATEGORY_ORDER } from "@tiny-agents/agent";
import { z } from "zod";
import type { MemoryCategory, MemoryRecord, MemorySource } from "../../../shared/api/memories";

export type { MemoryCategory, MemoryRecord, MemorySource };

export { MEMORY_RENDER_CHAR_CAP, renderMemoryBlock } from "@tiny-agents/agent";

const MEMORY_CATEGORIES = [
  "preference",
  "fact",
  "goal",
  "habit",
] as const satisfies readonly MemoryCategory[];

export const CATEGORY_ORDER: readonly MemoryCategory[] = MEMORY_CATEGORY_ORDER;

export const MEMORY_MAX_ACTIVE = 60;
const MEMORY_TEXT_MAX = 300;
export const MEMORY_CAPTURE_CHAR_CAP = 24_000;
export const MEMORY_REMOVED_IN_PROMPT = 30;
export const MEMORY_TRIVIAL_BYTES = 24;
export const MEMORY_QUIET_MS = 2 * 60_000;
export const MEMORY_TURN_LIMIT = 6;

export const memoryTextSchema = z.string().trim().min(1).max(MEMORY_TEXT_MAX);

export const memoryCategorySchema = z.enum(MEMORY_CATEGORIES);

export function isExpired(memory: Pick<MemoryRecord, "until">, now: Date = new Date()): boolean {
  return memory.until !== null && new Date(memory.until).getTime() <= now.getTime();
}

const untilSchema = z
  .string()
  .regex(
    /^(\d{4}-\d{2}-\d{2})(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/,
    "until must be a date or datetime",
  )
  .nullable()
  .optional();

export const extractedMemorySchema = z.object({
  text: memoryTextSchema,
  category: memoryCategorySchema,
  until: untilSchema,
  supersedesIds: z.array(z.string()).max(10).nullable().optional(),
});

export const extractionResultSchema = z
  .array(extractedMemorySchema)
  .max(20)
  .nullable()
  .transform((v) => v ?? []);

export type ExtractedMemory = z.infer<typeof extractedMemorySchema>;
