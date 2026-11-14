/**
 * What every request/response resource on the client shares (rewrite §4.5:
 * React Query for those, Zustand only for the live stores). The Tasks,
 * Routines, Skills and Memory pages moved here from hand-rolled fetching in
 * rewrite step 5.2, and Connections, Vault and Models in 5.3; each kept what a
 * user saw (the tables in docs/rewrite/README.md §4.5), so the shell's query
 * defaults are overridden for them.
 */
import { useCallback, useState } from "react";
import {
  hashKey,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
  type UseQueryOptions,
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

/**
 * What a page may change about how its resource lands: `structuralSharing:
 * false` makes every answer a new object even when nothing changed, and
 * `placeholderData: keepPreviousData` keeps the last key's answer on screen
 * until the next key's lands.
 */
export type ResourceOptions<T> = Pick<
  UseQueryOptions<T, Error, T, QueryKey>,
  "structuralSharing" | "placeholderData"
>;

/** Read `queryKey` with `RESOURCE_QUERY`; a failure is worded with `fallback`. */
export function useResource<T>(
  queryKey: QueryKey,
  queryFn: () => Promise<T>,
  fallback: string,
  options: ResourceOptions<T> = {},
): Resource<T> {
  const query = useQuery({ queryKey, queryFn, ...RESOURCE_QUERY, ...options });
  return {
    data: query.data ?? null,
    loadError: useLoadError(query, queryKey, fallback),
    refresh: useRefresh(queryKey),
  };
}

/**
 * Refetch the resource under `queryKey` now. A fetch still in flight is
 * dropped first, so the answer to the newest request is the one shown. The
 * same function while the key stays the same, so a page can subscribe it to
 * an event.
 */
function useRefresh(queryKey: QueryKey): () => Promise<void> {
  const client = useQueryClient();
  const hash = hashKey(queryKey);
  return useCallback(
    async () => {
      await client.cancelQueries({ queryKey });
      await client.invalidateQueries({ queryKey });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key is compared by its hash
    [client, hash],
  );
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

/**
 * A write whose request or answer carries a secret (a key, a password, a
 * vault value, a revealed value). It runs as a `RESOURCE_MUTATION`, and once
 * it answers it is reset and, with `gcTime: 0`, dropped from the mutation
 * cache, so what it sent and got lives only where the caller keeps it.
 * Called like a mutation: `await write.mutateAsync(variables)`.
 */
export function useSecretMutation<TVariables, TData>(
  mutationFn: (variables: TVariables) => Promise<TData>,
): { mutateAsync: (variables: TVariables) => Promise<TData> } {
  const { mutateAsync, reset } = useMutation({ mutationFn, ...RESOURCE_MUTATION, gcTime: 0 });
  const run = useCallback(
    async (variables: TVariables) => {
      try {
        return await mutateAsync(variables);
      } finally {
        reset();
      }
    },
    [mutateAsync, reset],
  );
  return { mutateAsync: run };
}
