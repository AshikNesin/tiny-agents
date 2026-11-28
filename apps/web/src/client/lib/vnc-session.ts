import type { ResizeBody } from "../../shared/api/live";
import { botsApi } from "./bots-api";

export type VncKind = "browser" | "computer";

export const botVncTicket = (kind: VncKind, botId: string) =>
  kind === "computer" ? botsApi.computerVncTicket(botId) : botsApi.browserVncTicket(botId);

export const resizeBotBrowser = (botId: string, size: ResizeBody) =>
  botsApi.browserResize(botId, size);
