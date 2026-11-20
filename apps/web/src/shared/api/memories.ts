import type { MemoryStatus } from "../machines/memory";

export type MemoryCategory = "preference" | "fact" | "goal" | "habit";

export type MemorySource = "capture" | "manual";

export interface MemoryRecord {
  id: string;
  botId: string;
  text: string;
  category: MemoryCategory;
  status: MemoryStatus;
  source: MemorySource;
  until: string | null;
  supersededById: string | null;
  supersededAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryList {
  memories: MemoryRecord[];
}

export interface MemoryResult {
  memory: MemoryRecord;
}

export interface MemoryCreateBody {
  text: string;
  category: MemoryCategory;
  until?: string | null;
}

export interface MemoryUpdateBody {
  text?: string;
  category?: MemoryCategory;
  until?: string | null;
  restore?: boolean;
}
