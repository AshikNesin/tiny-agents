import { parseEach, parseJson } from "@tiny-agents/std";
import { logger } from "@groot/core/logger";
import { z } from "zod";
import type { McpToolInfo } from "@tiny-agents/agent";
import type { ModelCatalog } from "@tiny-agents/models";

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

const PROJECT_TOOLKIT = "project";

const PROJECT_BOT_TOOLKITS = [
  PROJECT_TOOLKIT,
  "tasks",
  "routines",
  "web",
  "skills",
  "memory",
  "today",
  "questions",
  "attachments",
] as const;

export const VISION_TOOLKIT = "vision";

export const TOOL_SEARCH_TOOLKIT = "tool-search";

export function connectionCapabilityId(slug: string): string {
  return `mcp:${slug}`;
}

export interface ConnectionToolColumns {
  toolsCache: string;
  disabledTools: string;
}

const jsonSchemaSchema = z.record(z.string(), z.unknown());

const cachedToolSchema = z.object({
  name: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  inputSchema: jsonSchemaSchema.optional(),
  outputSchema: jsonSchemaSchema.optional(),
  readOnly: z.boolean().optional(),
  idempotent: z.boolean().optional(),
  destructive: z.boolean().optional(),
  openWorld: z.boolean().optional(),
});

export type CachedTool = z.infer<typeof cachedToolSchema>;

export function parseTools(raw: string): CachedTool[] {
  try {
    return parseEach(
      parseJson("A connection's cached tools", raw, z.array(z.unknown())),
      cachedToolSchema,
      (_value, problem) =>
        logger.warn({ problem }, "Skipped a cached connection tool that does not fit its shape"),
    );
  } catch {
    return [];
  }
}

export function installableTool(tool: CachedTool): McpToolInfo {
  return { ...tool, inputSchema: tool.inputSchema ?? {} };
}

export function parseDisabledTools(raw: string): Set<string> {
  try {
    const names = parseJson("A connection's disabled tools", raw, z.array(z.unknown()));
    return new Set(names.filter((n) => typeof n === "string"));
  } catch {
    return new Set();
  }
}

export function connectionTools(connection: ConnectionToolColumns): CachedTool[];
export function connectionTools<T extends { name: string }>(
  connection: ConnectionToolColumns,
  tools: T[],
): T[];
export function connectionTools(
  connection: ConnectionToolColumns,
  tools: Array<{ name: string }> = parseTools(connection.toolsCache),
): Array<{ name: string }> {
  const disabled = parseDisabledTools(connection.disabledTools);
  return tools.filter((tool) => !disabled.has(tool.name));
}

export function botModelId(
  catalog: Pick<ModelCatalog, "forRole">,
  modelId: string | null | undefined,
): string {
  return modelId ?? catalog.forRole("bot_default")?.id ?? "";
}

export function modelSeesImages(
  catalog: Pick<ModelCatalog, "get" | "forRole">,
  modelId: string | null,
): boolean {
  return Boolean(catalog.get(botModelId(catalog, modelId))?.vision);
}

export interface BotConnectionTools extends ConnectionToolColumns {
  slug: string;
}

export function botToolkits(
  bot: {
    modelId: string | null;
    projectId?: string | null;
    connections?: readonly BotConnectionTools[];
  },
  catalog: Pick<ModelCatalog, "get" | "forRole">,
): string[] {
  const connections = bot.connections ?? [];
  return [
    ...(bot.projectId ? PROJECT_BOT_TOOLKITS : BOT_TOOLKITS),
    ...(modelSeesImages(catalog, bot.modelId) ? [] : [VISION_TOOLKIT]),
    ...connections.map((connection) => connectionCapabilityId(connection.slug)),
    TOOL_SEARCH_TOOLKIT,
  ];
}

export function missingToolkits(installed: Iterable<string>): string[] {
  const have = new Set(installed);
  return [...BOT_TOOLKITS, PROJECT_TOOLKIT, VISION_TOOLKIT, TOOL_SEARCH_TOOLKIT].filter(
    (id) => !have.has(id),
  );
}
