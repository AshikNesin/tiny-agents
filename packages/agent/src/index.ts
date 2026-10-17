/**
 * @tiny-agents/agent — the only module in tiny-agents that touches pi-durable.
 *
 * Everything the app needs (durable bot conversations, chat streams, bot
 * activity, the gateway model catalog) is exposed through app-shaped types so
 * pi-durable API churn stays contained here. Child-only package: excluded from
 * groot sync via `.groot/boilerplate-sync.json` `additional_exclusions`.
 */
export { AgentRuntime, ConversationNotFoundError, type AgentRuntimeOptions } from "./runtime";
export { StoreLockedError, acquireStoreLock, type StoreLock } from "./lock";
export {
  GATEWAY_ENV_KEYS,
  GATEWAY_PROVIDER,
  createGatewayModels,
  isGatewayConfigured,
} from "./models";
export { deriveChat, diffChat, chatState, type RawChat } from "./transcript";
export type * from "./types";
