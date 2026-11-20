import type { JobAction, JobState } from "./types";
import { Play, RefreshCw, Trash2, X, type LucideIcon } from "lucide-react";

export type StateTab = "all" | JobState;

export const JOBS_PAGE_SIZE = 50;

export const STATE_TABS: { value: StateTab; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "created", label: "Created" },
  { value: "failed", label: "Failed" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

const PRIMARY_TABS: StateTab[] = ["all", "active", "failed", "completed"];

export const primaryOptions = STATE_TABS.filter((t) => PRIMARY_TABS.includes(t.value));
export const secondaryOptions = STATE_TABS.filter((t) => !PRIMARY_TABS.includes(t.value));

export function stateLabel(state: string): string {
  return STATE_TABS.find((t) => t.value === state)?.label ?? state;
}

export const JOB_ACTION_UI: Record<
  JobAction,
  { label: string; icon: LucideIcon; destructive?: boolean }
> = {
  retry: { label: "Retry", icon: RefreshCw },
  rerun: { label: "Re-run", icon: Play },
  resume: { label: "Resume", icon: Play },
  cancel: { label: "Cancel", icon: X },
  delete: { label: "Delete", icon: Trash2, destructive: true },
};

/**
 * @deprecated The jobs list filter is `useJobsFilter()` (`@groot/jobs/client/useJobsFilter`):
 * change it through its intent setters (`setState`, `setQueue`, `setSearch`, `setPreset`,
 * `goToPage`, `clear`), which also reset the page. Removed in the next major.
 */
export type JobsQueryPatch = Partial<{
  state: string;
  queue: string;
  search: string;
  page: number;
  startDate: string | null;
  endDate: string | null;
  datePreset: string;
}>;
