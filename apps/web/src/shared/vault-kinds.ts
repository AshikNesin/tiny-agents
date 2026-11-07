import type { VaultKind } from "@tiny-agents/agent";

export const KIND_DEFAULT_TOOLS: Record<VaultKind, string[]> = {
  login: ["browser_fill_secret", "browser_enter_code", "computer_fill_secret"],
  card: ["browser_fill_secret"],
  identity: [],
  api_key: ["http_request", "mcp"],
};
