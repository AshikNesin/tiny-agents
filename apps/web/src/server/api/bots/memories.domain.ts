/**
 * Memory domain (issue #22), pure and DB-free: the typed lifecycle, budget
 * constants, deterministic rendering, and the capture contract that every
 * surface (section, capture, API, UI) reuses. Rows, not files: the domain
 * object is a fact with a lifecycle, and the typed row makes invalid states
 * unrepresentable at every boundary instead of parseable out of markdown.
 */
import { MEMORY_CATEGORY_ORDER } from "@tiny-agents/agent";
import { z } from "zod";
import type { MemoryStatus } from "../../../shared/machines/memory";

/** The injected block's render lives with the prompt section that injects it. */
export { MEMORY_RENDER_CHAR_CAP, renderMemoryBlock } from "@tiny-agents/agent";

const MEMORY_CATEGORIES = ["preference", "fact", "goal", "habit"] as const;
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

const MEMORY_SOURCES = ["capture", "manual"] as const;
export type MemorySource = (typeof MEMORY_SOURCES)[number];

/** Category display order in every rendered surface (prompt and page). */
export const CATEGORY_ORDER: readonly MemoryCategory[] = MEMORY_CATEGORY_ORDER;

export const MEMORY_MAX_ACTIVE = 100;
const MEMORY_TEXT_MAX = 300;
/** Capture window cap: the newest transcript characters one extraction reads. */
export const MEMORY_CAPTURE_CHAR_CAP = 24_000;
/** Deleted memories the capture prompt lists as never-re-add. */
export const MEMORY_REMOVED_IN_PROMPT = 30;
/** Capture skip threshold: fewer owner bytes than this since the watermark. */
export const MEMORY_TRIVIAL_BYTES = 24;
/** Capture debounce: quiet window / turn count (OpenMausBot's proven pair). */
export const MEMORY_QUIET_MS = 2 * 60_000;
export const MEMORY_TURN_LIMIT = 6;

export const memoryTextSchema = z.string().trim().min(1).max(MEMORY_TEXT_MAX);

export const memoryCategorySchema = z.enum(MEMORY_CATEGORIES);

/** A memory row as the app surfaces see it (ISO dates, typed enums). */
export interface MemoryRecord {
  id: string;
  botId: string;
  text: string;
  category: MemoryCategory;
  status: MemoryStatus;
  source: MemorySource;
  confidence: number | null;
  until: string | null;
  supersededById: string | null;
  supersededAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function isExpired(memory: Pick<MemoryRecord, "until">, now: Date = new Date()): boolean {
  return memory.until !== null && new Date(memory.until).getTime() <= now.getTime();
}

/**
 * The extraction contract (issue #22 §5.3). The model proposes; code decides.
 * Invalid arrays are dropped whole, never partially applied.
 */
/** Accepts full ISO datetimes and date-only values (models send "2026-10-30"). */
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
  confidence: z.number().min(0).max(1),
  supersedesIds: z.array(z.string()).max(10).nullable().optional(),
});

export const extractionResultSchema = z
  .array(extractedMemorySchema)
  .max(20)
  .nullable()
  .transform((v) => v ?? []);

export type ExtractedMemory = z.infer<typeof extractedMemorySchema>;
