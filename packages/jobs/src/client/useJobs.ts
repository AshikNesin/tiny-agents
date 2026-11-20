import { jobsApi } from "./api";
import type { Job } from "./types";
import { JOBS_STALE_TIME, jobsKeys } from "./queries";
import { useJobsFilter } from "./useJobsFilter";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

export function useJobs() {
  const filter = useJobsFilter();

  const jobsQuery = useQuery({
    queryKey: [
      ...jobsKeys.list,
      filter.state,
      filter.queue,
      filter.search.trim(),
      filter.preset,
      filter.page,
    ],
    queryFn: () => jobsApi.getJobs(filter.listParams()),
    placeholderData: keepPreviousData,
    staleTime: JOBS_STALE_TIME,
  });

  const jobs: Job[] = jobsQuery.data?.jobs ?? [];

  return {
    filter,
    jobs,
    total: jobsQuery.data?.total ?? 0,
    loading: jobsQuery.isLoading,
    error: jobsQuery.error
      ? jobsQuery.error instanceof Error
        ? jobsQuery.error.message
        : "Failed to load jobs"
      : null,
    lastRefreshed: jobsQuery.dataUpdatedAt ? new Date(jobsQuery.dataUpdatedAt) : null,
  };
}
