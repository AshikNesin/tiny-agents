import { botsApi } from "../lib/bots-api";
import { useResource } from "./resource";

export const usePastChatList = (botId: string) =>
  useResource(
    ["bots", "past-chats", botId],
    () => botsApi.pastChats(botId),
    "Failed to load chats",
  );

export const useComputerStatus = (botId: string) =>
  useResource(
    ["bots", "computer", botId],
    () => botsApi.computerStatus(botId),
    "Failed to load the computer",
  );
