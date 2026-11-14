/**
 * What every request/response resource on the client shares (rewrite §4.5:
 * React Query for those, Zustand only for the live stores). The Tasks,
 * Routines, Skills and Memory pages moved here from hand-rolled fetching in
 * rewrite step 5.2 and kept what a user saw (the table in
 * docs/rewrite/README.md §4.5), so the shell's query defaults are overridden
 * for them.
 */
import { useState } from "react";
import {
  hashKey,
  useQuery,
  useQueryClient,
  type QueryKey,
  type UseQueryResult,
} from "@tanstack/react-query";
import { errorMessage } from "../lib/errors";

/**
 * Query options for a page's resource: fetched on every mount, never shown
 * from a cache a previous visit left (the page shows its loading state
 * again), and refetched only when the page asks. A failure shows at once,
 * and offline fails with the offline sentence instead of pausing until the
 * browser says it is back.
 */
export const RESOURCE_QUERY = {
  staleTime: 0,
  gcTime: 0,
  retry: false,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  networkMode: "always",
} as const;

/** A write runs once (the app's default retries a mutation once) and never waits for the network to look online. */
export const RESOURCE_MUTATION = { retry: false, networkMode: "always" } as const;

/** A page's resource as the page reads it. */
export interface Resource<T> {
  /** The last list or record that landed; null until the first one does. */
  data: T | null;
  /** Why the last fetch failed (`errorMessage` wording), until one succeeds. */
  loadError: string | null;
  /** Fetch again now; resolves once it has landed or failed, never rejects. */
  refresh: () => Promise<void>;
}

/** Read `queryKey` with `RESOURCE_QUERY`; a failure is worded with `fallback`. */
export function useResource<T>(
  queryKey: QueryKey,
  queryFn: () => Promise<T>,
  fallback: string,
): Resource<T> {
  const query = useQuery({ queryKey, queryFn, ...RESOURCE_QUERY });
  return {
    data: query.data ?? null,
    loadError: useLoadError(query, queryKey, fallback),
    refresh: useRefresh(queryKey),
  };
}

/**
 * Refetch the resource under `queryKey` now. A fetch still in flight is
 * dropped first, so the answer to the newest request is the one shown.
 */
function useRefresh(queryKey: QueryKey): () => Promise<void> {
  const client = useQueryClient();
  return async () => {
    await client.cancelQueries({ queryKey });
    await client.invalidateQueries({ queryKey });
  };
}

/**
 * The last fetch's failure, or null once a fetch succeeds. React Query
 * clears a query's error as soon as a retry starts while it has no data; the
 * pages kept showing it until the retry answered, so it is kept here until
 * then. Another `queryKey` starts clean.
 */
function useLoadError(
  query: UseQueryResult<unknown>,
  queryKey: QueryKey,
  fallback: string,
): string | null {
  const hash = hashKey(queryKey);
  const [kept, setKept] = useState<{ hash: string; error: unknown } | null>(null);
  const previous = kept?.hash === hash ? kept.error : null;
  const error = query.error ?? (query.status === "success" ? null : previous);
  if (error !== previous || (kept !== null && kept.hash !== hash)) {
    setKept(error ? { hash, error } : null);
  }
  return error ? errorMessage(error, fallback) : null;
}
