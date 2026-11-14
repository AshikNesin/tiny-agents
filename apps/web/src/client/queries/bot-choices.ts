/**
 * The bots a form offers (a routine's bot, the bots a skill is used by): a
 * plain read of `GET /bots`, separate from the live bot list in
 * `store/bots.ts`. A failed read offers no bots rather than an error.
 */
import { useQuery } from "@tanstack/react-query";
import { botsApi } from "../lib/bots-api";
import { RESOURCE_QUERY } from "./resource";

/**
 * Read while `enabled`, again each time it turns on; the last list stays
 * meanwhile. Every read lands as a new array, even when nothing changed, so
 * a form can act on each one.
 */
export function useBotChoices({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ["bot-choices"],
    queryFn: () => botsApi.list().catch(() => []),
    enabled,
    ...RESOURCE_QUERY,
    structuralSharing: false,
  });
}
