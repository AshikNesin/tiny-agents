import { useEffect, type ReactNode } from "react";
import { QueryClient, QueryClientProvider, type DefaultOptions } from "@tanstack/react-query";
import { useAuthStore } from "@groot/shell/store/auth";

export const SHELL_QUERY_DEFAULTS = {
  queries: {
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 30,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: 1,
  },
  mutations: {
    retry: false,
  },
} as const satisfies DefaultOptions;

export function createShellQueryClient(overrides: DefaultOptions = {}): QueryClient {
  return new QueryClient({
    defaultOptions: {
      ...overrides,
      queries: { ...SHELL_QUERY_DEFAULTS.queries, ...overrides.queries },
      mutations: { ...SHELL_QUERY_DEFAULTS.mutations, ...overrides.mutations },
    },
  });
}

function resetForNewSession(client: QueryClient): void {
  client.getMutationCache().clear();
  client.removeQueries({ type: "inactive" });
  void client.resetQueries({ type: "active" });
}

export function bindQueryClientToSession(client: QueryClient): () => void {
  let generation = useAuthStore.getState().generation;
  return useAuthStore.subscribe((state) => {
    if (state.generation === generation) return;
    generation = state.generation;
    resetForNewSession(client);
  });
}

export function ShellQueryProvider({
  client,
  children,
}: {
  client: QueryClient;
  children: ReactNode;
}) {
  useEffect(() => bindQueryClientToSession(client), [client]);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
