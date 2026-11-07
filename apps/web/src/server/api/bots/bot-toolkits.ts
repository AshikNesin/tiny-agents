/**
 * Which capabilities a bot's conversation selects, decided in one place.
 *
 * Every bot gets every built-in toolkit (ADR 0004); on top of those come the
 * automatic ones (vision for a model that cannot see images, tool search
 * while one of its connections is large) and one `mcp:<slug>` per linked
 * connection. The selection names capabilities by id, and an id the runtime
 * has not installed is silently ignored at configure, so `missingToolkits`
 * checks the list against the runtime at boot (and a test checks it in CI).
 *
 * A connection's cached tools and the tools the owner turned off are parsed
 * here too, so the ConnectionManager (which installs a connection's tools and
 * tool search) and the selection count a connection's tools the same way.
 */
import { MCP_DEFER_THRESHOLD, type McpToolInfo, type ModelCatalog } from "@tiny-agents/agent";

/**
 * The built-in toolkits every bot gets. There is no per-bot selection: a bot
 * is shaped by its tool permissions (Off removes a tool from the model), and
 * effectful tools ask the owner before they run (ADR 0004).
 */
export const BOT_TOOLKITS = [
  "tasks",
  "routines",
  "web",
  "sandbox",
  "browser",
  "computer",
  "bots",
  "skills",
  "memory",
  "self-improve",
  "bot-builder",
  "today",
  "questions",
  "vault",
  "attachments",
  "code",
] as const;

/** The see_image side-call, selected for models without native vision. */
export const VISION_TOOLKIT = "vision";

/** `tool_search`, selected while one of the bot's connections defers its tools. */
export const TOOL_SEARCH_TOOLKIT = "tool-search";

/** Capability id of a connection (`mcp:<slug>`); also its tool-name prefix source. */
export function connectionCapabilityId(slug: string): string {
  return `mcp:${slug}`;
}

/** A connection's stored tool columns (`connections.toolsCache`, `connections.disabledTools`). */
export interface ConnectionToolColumns {
  /** JSON array of the server's tools as last listed. */
  toolsCache: string;
  /** JSON array of server tool names the owner turned off for every bot. */
  disabledTools: string;
}

/** The cached tool list; anything unreadable is no tools. */
export function parseTools(raw: string): McpToolInfo[] {
  try {
    const tools = JSON.parse(raw) as unknown;
    return Array.isArray(tools)
      ? (tools.filter((tool) => typeof tool === "object" && tool !== null) as McpToolInfo[])
      : [];
  } catch {
    return [];
  }
}

/** Server tool names the owner turned off for every bot. */
export function parseDisabledTools(raw: string): Set<string> {
  try {
    const names = JSON.parse(raw) as unknown;
    return new Set(Array.isArray(names) ? names.filter((n) => typeof n === "string") : []);
  } catch {
    return new Set();
  }
}

/**
 * The tools a connection installs: its tool list (the live one when given,
 * else the cached one) minus those the owner turned off.
 */
export function connectionTools(
  connection: ConnectionToolColumns,
  tools: McpToolInfo[] = parseTools(connection.toolsCache),
): McpToolInfo[] {
  const disabled = parseDisabledTools(connection.disabledTools);
  return tools.filter((tool) => !disabled.has(tool.name));
}

/**
 * A connection with more installed tools than `MCP_DEFER_THRESHOLD` defers
 * them; the model finds them through `tool_search`.
 */
export function needsToolSearch(installedTools: readonly unknown[]): boolean {
  return installedTools.length > MCP_DEFER_THRESHOLD;
}

/**
 * The model a bot runs on: its own, or the `bot_default` role when it has
 * none (its model was never set, or the row predates models as data).
 */
export function botModelId(
  catalog: Pick<ModelCatalog, "forRole">,
  modelId: string | null | undefined,
): string {
  return modelId ?? catalog.forRole("bot_default")?.id ?? "";
}

/** Whether the model reads image blocks natively (else the see_image side-call). */
export function modelSeesImages(
  catalog: Pick<ModelCatalog, "get" | "forRole">,
  modelId: string | null,
): boolean {
  return Boolean(catalog.get(botModelId(catalog, modelId))?.vision);
}

/** A connection linked to the bot, as the selection reads it. */
export interface BotConnectionTools extends ConnectionToolColumns {
  slug: string;
}

/**
 * The capability ids a bot's conversation enables: every built-in toolkit,
 * vision when its model cannot see images, each linked connection, and tool
 * search when one of them is large.
 */
export function botToolkits(
  bot: { modelId: string | null; connections?: readonly BotConnectionTools[] },
  catalog: Pick<ModelCatalog, "get" | "forRole">,
): string[] {
  const connections = bot.connections ?? [];
  const large = connections.some((connection) => needsToolSearch(connectionTools(connection)));
  return [
    ...BOT_TOOLKITS,
    ...(modelSeesImages(catalog, bot.modelId) ? [] : [VISION_TOOLKIT]),
    ...connections.map((connection) => connectionCapabilityId(connection.slug)),
    ...(large ? [TOOL_SEARCH_TOOLKIT] : []),
  ];
}

/**
 * Ids a bot may select that the runtime has not installed (`installed`: the
 * runtime's capability ids). Connections and tool search come and go with
 * the ConnectionManager, so only the built-ins and vision are checked.
 */
export function missingToolkits(installed: Iterable<string>): string[] {
  const have = new Set(installed);
  return [...BOT_TOOLKITS, VISION_TOOLKIT].filter((id) => !have.has(id));
}
