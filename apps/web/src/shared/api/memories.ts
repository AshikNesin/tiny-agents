/** The Memory page's wire types (`server/api/bots/memories.*`, issue #22); naming in `./common.ts`. */
import type { MemoryStatus } from "../machines/memory";

export type MemoryCategory = "preference" | "fact" | "goal" | "habit";

export type MemorySource = "capture" | "manual";

/**
 * A memory row as the app surfaces see it: the server already sends ISO
 * dates and typed enums (`memories.service.ts`). Only `active` is ever
 * injected; the rest is visible history (issue #22 5.4).
 */
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

/** `GET /bots/:id/memories`. */
export interface MemoryList {
  memories: MemoryRecord[];
}

/** `POST /bots/:id/memories` and `PATCH /memories/:id`. */
export interface MemoryResult {
  memory: MemoryRecord;
}

/** `POST /bots/:id/memories`. */
export interface MemoryCreateBody {
  text: string;
  category: MemoryCategory;
  until?: string | null;
}

/** `PATCH /memories/:id`: at least one field; `restore` brings a deleted one back. */
export interface MemoryUpdateBody {
  text?: string;
  category?: MemoryCategory;
  until?: string | null;
  restore?: boolean;
}
