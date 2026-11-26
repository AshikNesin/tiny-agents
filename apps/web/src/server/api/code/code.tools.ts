import {
  mcpToolName,
  SKILL_NAME,
  type McpCallResult,
  type ToolPermission,
} from "@tiny-agents/agent";
import type { AppToolPort } from "@tiny-agents/code/server";
import { and, eq } from "drizzle-orm";
import { connections, db } from "../../db";
import { connectionCapabilityId, connectionTools } from "../bots/bot-toolkits";
import { ownerToolPermissions } from "../bots/tool-permissions";
import { getConnectionManager, type ConnectionManager } from "../connections/connections.manager";
import { sharedSkills } from "../skills/skills.store";
import type { SkillFile } from "../../../shared/api/skills";

type Connections = Pick<ConnectionManager, "call" | "status">;

const DESCRIPTION_MAX = 2_048;

export async function sharedConnectionToolkits(): Promise<string[]> {
  const rows = await db
    .select({ slug: connections.slug })
    .from(connections)
    .where(eq(connections.allBots, true));
  return rows.map((row) => connectionCapabilityId(row.slug));
}

function permissionOf(owner: Record<string, ToolPermission>, slug: string, tool: string) {
  return owner[mcpToolName(slug, tool)] ?? "ask";
}

function textOf(result: McpCallResult): string {
  return result.content
    .map((block) =>
      block.type === "text" && block.text !== undefined ? block.text : JSON.stringify(block),
    )
    .join("\n");
}

export function claudeCodeTools(live: () => Connections = getConnectionManager): AppToolPort {
  return {
    async list() {
      const [rows, owner] = await Promise.all([
        db.select().from(connections).where(eq(connections.allBots, true)),
        ownerToolPermissions(),
      ]);
      return rows
        .filter((row) => live().status(row.id).status !== "needs_auth")
        .flatMap((row) =>
          connectionTools(row).flatMap((tool) => {
            const permission = permissionOf(owner, row.slug, tool.name);
            if (permission === "off") return [];
            return [
              {
                server: row.slug,
                name: tool.name,
                description: (tool.description ?? tool.title ?? tool.name).slice(
                  0,
                  DESCRIPTION_MAX,
                ),
                inputSchema:
                  tool.inputSchema && typeof tool.inputSchema === "object"
                    ? tool.inputSchema
                    : { type: "object" },
                ask: permission === "ask",
              },
            ];
          }),
        );
    },
    async call(server, tool, input) {
      const [row, owner] = await Promise.all([
        db.query.connections.findFirst({
          where: and(eq(connections.slug, server), eq(connections.allBots, true)),
        }),
        ownerToolPermissions(),
      ]);
      if (
        !row ||
        !connectionTools(row).some((known) => known.name === tool) ||
        permissionOf(owner, server, tool) === "off"
      ) {
        return { content: `${server} ${tool} is not available to Code threads.`, isError: true };
      }
      const result = await live().call(row.id, tool, input);
      return { content: textOf(result), ...(result.isError ? { isError: true } : {}) };
    },
  };
}

function skillFiles(raw: string): SkillFile[] {
  const parsed = JSON.parse(raw) as unknown;
  return Array.isArray(parsed) ? (parsed as SkillFile[]) : [];
}

export async function claudeCodeSkills() {
  return (await sharedSkills())
    .filter((skill) => SKILL_NAME.test(skill.name))
    .map((skill) => ({
      name: skill.name,
      description: skill.description,
      body: skill.body,
      files: skillFiles(skill.files).map(({ path, content }) => ({ path, content })),
    }));
}
