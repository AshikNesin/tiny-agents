import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import type { BotListEntry } from "../../shared/api/bots";
import type { MemoryCreateBody, MemoryRecord, MemoryUpdateBody } from "../../shared/api/memories";
import { botsApi } from "../lib/bots-api";
import { useBotsStore } from "../store/bots";
import { RESOURCE_MUTATION, RESOURCE_QUERY, useResource } from "./resource";

const memoryEnabledKey = (botId: string) => ["memory", "enabled", botId] as const;

export const useMemories = () =>
  useResource(
    ["memory", "list"],
    async (): Promise<{ bots: BotListEntry[]; memories: Record<string, MemoryRecord[]> }> => {
      const bots = await useBotsStore.getState().loadBots();
      const lists = await Promise.all(bots.map((bot) => botsApi.listMemories(bot.id)));
      return {
        bots,
        memories: Object.fromEntries(bots.map((bot, i) => [bot.id, lists[i].memories])),
      };
    },
    "Failed to load memories",
  );

export function useMemoryEnabled(bots: BotListEntry[]): Record<string, boolean | undefined> {
  return useQueries({
    queries: bots.map((bot) => ({
      queryKey: memoryEnabledKey(bot.id),
      queryFn: () =>
        botsApi
          .get(bot.id)
          .then((full) => full.memoryEnabled)
          .catch(() => true),
      ...RESOURCE_QUERY,
      staleTime: Infinity,
    })),
    combine: (results) =>
      Object.fromEntries(bots.map((bot, i) => [bot.id, results[i]?.data])) as Record<
        string,
        boolean | undefined
      >,
  });
}

export function useSetMemoryEnabled() {
  const client = useQueryClient();
  return (botId: string, on: boolean) => client.setQueryData(memoryEnabledKey(botId), on);
}

export function useMemoryMutations() {
  const create = useMutation({
    mutationFn: ({ botId, input }: { botId: string; input: MemoryCreateBody }) =>
      botsApi.createMemory(botId, input),
    ...RESOURCE_MUTATION,
  });
  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: MemoryUpdateBody }) =>
      botsApi.updateMemory(id, input),
    ...RESOURCE_MUTATION,
  });
  const remove = useMutation({
    mutationFn: (id: string) => botsApi.deleteMemory(id),
    ...RESOURCE_MUTATION,
  });
  const setEnabled = useMutation({
    mutationFn: ({ botId, on }: { botId: string; on: boolean }) =>
      botsApi.update(botId, { memoryEnabled: on }),
    ...RESOURCE_MUTATION,
  });
  return { create, update, remove, setEnabled };
}
