import { useCallback, useEffect, useRef, useState } from "react";
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

export const RESOURCE_QUERY = {
  staleTime: 0,
  gcTime: 0,
  retry: false,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  networkMode: "always",
} as const;

export const RESOURCE_MUTATION = { retry: false, networkMode: "always" } as const;

export function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

export function useRefreshOn(trigger: unknown, refresh: () => Promise<void>): void {
  const readFor = useRef(trigger);
  useEffect(() => {
    if (Object.is(readFor.current, trigger)) return;
    readFor.current = trigger;
    void refresh();
  }, [trigger, refresh]);
}

export type Resource<T> = { refresh: () => Promise<void> } & (
  | { status: "loading" }
  | { status: "failed"; loadError: string; last: T | undefined }
  | { status: "ready"; data: T }
);

export type ResourceOptions<T> = Pick<
  UseQueryOptions<T, Error, T, QueryKey>,
  "structuralSharing" | "placeholderData" | "enabled"
>;

export function useResource<T>(
  queryKey: QueryKey,
  queryFn: () => Promise<T>,
  fallback: string,
  options: ResourceOptions<T> = {},
): Resource<T> {
  const query = useQuery({ queryKey, queryFn, ...RESOURCE_QUERY, ...options });
  const loadError = useLoadError(query, queryKey, fallback);
  const refresh = useRefresh(queryKey);
  if (loadError !== null) return { status: "failed", loadError, last: query.data, refresh };
  if (query.data !== undefined) return { status: "ready", data: query.data, refresh };
  return { status: "loading", refresh };
}

function useRefresh(queryKey: QueryKey): () => Promise<void> {
  const client = useQueryClient();
  const hash = hashKey(queryKey);
  return useCallback(
    async () => {
      await client.cancelQueries({ queryKey });
      await client.invalidateQueries({ queryKey });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client, hash],
  );
}

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
