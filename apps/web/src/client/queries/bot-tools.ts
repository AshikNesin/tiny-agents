import { botsApi } from "../lib/bots-api";
import { useResource } from "./resource";

export const useBotTools = (botId: string, options: { enabled?: boolean } = {}) =>
  useResource(
    ["bots", "tools", botId],
    () => botsApi.tools(botId),
    "Failed to load tools",
    options,
  );
