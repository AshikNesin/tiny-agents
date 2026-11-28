import { botsApi } from "../lib/bots-api";
import { useResource } from "./resource";

export const useCapabilities = (fallback: string, options: { enabled?: boolean } = {}) =>
  useResource(["capabilities"], () => botsApi.capabilities(), fallback, {
    staleTime: Infinity,
    gcTime: Infinity,
    ...options,
  });
