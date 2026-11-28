import { useQuery } from "@tanstack/react-query";
import { botsApi } from "../lib/bots-api";
import { RESOURCE_QUERY } from "./resource";

export function useBotChoices({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ["bot-choices"],
    queryFn: () => botsApi.list(),
    enabled,
    ...RESOURCE_QUERY,
    structuralSharing: false,
  });
}
