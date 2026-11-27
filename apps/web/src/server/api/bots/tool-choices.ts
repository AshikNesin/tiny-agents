import { Boom } from "@groot/core/errors";
import { mcpToolName, type McpToolInfo, type ToolPermission } from "@tiny-agents/agent";
import type { ToolChoice } from "@tiny-agents/code/contracts";
import type { ConnectionManager } from "../connections/connections.manager";
import { connectionPick, TOOL_PICK } from "../../../shared/tool-picks";
import { connectionTools, type ConnectionToolColumns } from "./bot-toolkits";

type Permissions = Record<string, ToolPermission>;

export interface ChoosableConnection extends ConnectionToolColumns {
  id: string;
  slug: string;
  name: string;
}

export interface UsableTool {
  connection: ChoosableConnection;
  tool: McpToolInfo;
  permission: ToolPermission;
}

export function usableTools(
  rows: readonly ChoosableConnection[],
  permissions: Permissions,
  live: Pick<ConnectionManager, "status">,
): UsableTool[] {
  return rows
    .filter((row) => live.status(row.id).status !== "needs_auth")
    .flatMap((row) =>
      connectionTools(row).flatMap((tool) => {
        const permission = permissions[mcpToolName(row.slug, tool.name)] ?? "ask";
        return permission === "off" ? [] : [{ connection: row, tool, permission }];
      }),
    );
}

export function toolChoices(usable: readonly UsableTool[]): ToolChoice[] {
  return usable.map(({ connection, tool }) => ({
    name: mcpToolName(connection.slug, tool.name),
    label: tool.title ?? tool.name,
    description: tool.description ?? "",
    connection: { slug: connection.slug, name: connection.name },
  }));
}

export function checkToolPicks(choices: readonly ToolChoice[], picks: readonly string[]): string[] {
  const offered = new Set(
    choices.flatMap((choice) => [choice.name, connectionPick(choice.connection.slug)]),
  );
  const unique = [...new Set(picks)];
  const missing = unique.filter((pick) => !TOOL_PICK.test(pick) || !offered.has(pick));
  if (missing.length > 0) {
    throw Boom.badRequest(`Not available in this chat: ${missing.join(", ")}`);
  }
  return unique;
}
