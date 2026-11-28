import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { TerminalList } from "../../shared/api/terminal";
import { terminalApi } from "../lib/terminal-api";
import { RESOURCE_MUTATION, useResource } from "./resource";

const TERMINAL_TABS_KEY = ["terminal", "tabs"] as const;
const TABS_POLL_MS = 5000;

export const useTerminalTabs = () =>
  useResource(TERMINAL_TABS_KEY, () => terminalApi.list(), "Failed to load terminal tabs", {
    refetchInterval: TABS_POLL_MS,
  });

export function useDropTerminalTab() {
  const client = useQueryClient();
  return (name: string) =>
    client.setQueryData<TerminalList>(TERMINAL_TABS_KEY, (list) =>
      list ? { ...list, sessions: list.sessions.filter((s) => s.name !== name) } : list,
    );
}

export function useTerminalTabMutations() {
  const create = useMutation({
    mutationFn: (size: { cols: number; rows: number } | undefined) => terminalApi.create(size),
    ...RESOURCE_MUTATION,
  });
  const remove = useMutation({
    mutationFn: ({ name, force }: { name: string; force: boolean }) =>
      terminalApi.remove(name, force),
    ...RESOURCE_MUTATION,
  });
  return { create, remove };
}
