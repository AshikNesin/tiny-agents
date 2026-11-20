import { parseAsInteger, parseAsString, parseAsStringLiteral, useQueryStates } from "nuqs";
import { endOfDay, startOfDay, startOfMonth, subtractDays } from "@groot/shell/lib/utils";
import { JOBS_PAGE_SIZE, STATE_TABS, secondaryOptions, type StateTab } from "./constants";

export const JOBS_DATE_PRESETS = ["all", "today", "last-7-days", "this-month"] as const;
export type JobsDatePreset = (typeof JOBS_DATE_PRESETS)[number];

export interface JobsListParams {
  state?: string;
  name?: string;
  search?: string;
  startDate?: string;
  endDate?: string;
  limit: number;
  offset: number;
}

const urlSchema = {
  state: parseAsStringLiteral(STATE_TABS.map((tab) => tab.value)).withDefault("all"),
  queue: parseAsString.withDefault("all"),
  search: parseAsString.withDefault(""),
  datePreset: parseAsStringLiteral(JOBS_DATE_PRESETS).withDefault("all"),
  page: parseAsInteger.withDefault(0),
};

function presetRange(preset: JobsDatePreset, now: Date): { startDate?: string; endDate?: string } {
  const start =
    preset === "today"
      ? startOfDay(now)
      : preset === "last-7-days"
        ? startOfDay(subtractDays(now, 6))
        : preset === "this-month"
          ? startOfMonth(now)
          : null;
  return start ? { startDate: start.toISOString(), endDate: endOfDay(now).toISOString() } : {};
}

export function useJobsFilter() {
  const [values, setValues] = useQueryStates(urlSchema);
  const { state, queue, search, datePreset: preset } = values;
  const page = Math.max(0, values.page);

  const refilter = (patch: {
    [K in Exclude<keyof typeof values, "page">]?: (typeof values)[K] | null;
  }) => void setValues({ ...patch, page: null });

  return {
    state,
    queue,
    search,
    preset,
    page,
    activeSecondaryTab: secondaryOptions.find((tab) => tab.value === state),
    hasActiveFilters:
      state !== "all" || queue !== "all" || search.trim() !== "" || preset !== "all",
    filterKey: JSON.stringify([state, queue, search, preset, page]),
    setState: (next: StateTab) => refilter({ state: next }),
    setQueue: (next: string) => refilter({ queue: next }),
    setSearch: (next: string) => refilter({ search: next }),
    setPreset: (next: JobsDatePreset) => refilter({ datePreset: next }),
    goToPage: (next: number) => void setValues({ page: Math.max(0, next) || null }),
    clear: () => refilter({ state: null, queue: null, search: null, datePreset: null }),
    listParams: (now: Date = new Date()): JobsListParams => {
      const query = search.trim();
      return {
        limit: JOBS_PAGE_SIZE,
        offset: page * JOBS_PAGE_SIZE,
        ...(state !== "all" && { state }),
        ...(queue !== "all" && { name: queue }),
        ...(query && { search: query }),
        ...presetRange(preset, now),
      };
    },
  };
}

export type JobsFilter = ReturnType<typeof useJobsFilter>;
