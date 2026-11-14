/** The Memory page's resources: every bot's memories, each bot's memory switch, and their writes. */
import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import type { BotListEntry } from "../../shared/api/bots";
import type { MemoryCreateBody, MemoryRecord, MemoryUpdateBody } from "../../shared/api/memories";
import { botsApi } from "../lib/bots-api";
import { useBotsStore } from "../store/bots";
import { RESOURCE_MUTATION, RESOURCE_QUERY, useResource } from "./resource";

const memoryEnabledKey = (botId: string) => ["memory", "enabled", botId] as const;

/** The bots and each one's memories, fetched together so they land together. */
export const useMemories = () =>
  useResource(
    ["memory", "list"],
    async (): Promise<{ bots: BotListEntry[]; memories: Record<string, MemoryRecord[]> }> => {
      // One list for the whole app: the store's, reloaded so a bot made
      // elsewhere shows up here too. loadBots resolves with the list that
      // actually landed — even when a concurrent load (app mount, the SSE
      // feed's refresh) superseded this one — so the page never snapshots a
      // stale store and shows "No bots yet" forever (issue #119).
      const bots = await useBotsStore.getState().loadBots();
      const lists = await Promise.all(bots.map((bot) => botsApi.listMemories(bot.id)));
      return {
        bots,
        memories: Object.fromEntries(bots.map((bot, i) => [bot.id, lists[i].memories])),
      };
    },
    "Failed to load memories",
  );

/**
 * Each bot's memory switch by bot id, undefined until read. The bot list
 * carries no memoryEnabled, so the switch reads the full bot once per visit
 * (a bot that cannot be read shows as on); after that only the page changes
 * it (`useSetMemoryEnabled`), and a refetch of the memories leaves it alone.
 */
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

/** Show a bot's switch as `on` at once, ahead of the server. */
export function useSetMemoryEnabled() {
  const client = useQueryClient();
  return (botId: string, on: boolean) => client.setQueryData(memoryEnabledKey(botId), on);
}

/**
 * The memory writes, and a bot's switch. None refetches: the page does after
 * each, at the point it always did (once the editor has closed).
 */
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
