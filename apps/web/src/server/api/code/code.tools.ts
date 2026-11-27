import {
  mcpToolName,
  SKILL_NAME,
  type McpCallResult,
  type ToolPermission,
} from "@tiny-agents/agent";
import type { AppToolPort } from "@tiny-agents/code/server";
import { connectionCapabilityId, connectionTools } from "../bots/bot-toolkits";
import { ownerToolPermissions } from "../bots/tool-permissions";
import { getConnectionManager, type ConnectionManager } from "../connections/connections.manager";
import { shQuote, type SandboxConnection } from "@tiny-agents/sandbox";
import { reachedConnections, reachedSkills } from "../bots/bot-reach";
import { skillFiles, skillHeading } from "../skills/skills.parse";

type Connections = Pick<ConnectionManager, "call" | "status">;

const DESCRIPTION_MAX = 2_048;

export async function sharedConnectionToolkits(): Promise<string[]> {
  const rows = await reachedConnections("code-thread");
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
        reachedConnections("code-thread"),
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
      const [rows, owner] = await Promise.all([
        reachedConnections("code-thread"),
        ownerToolPermissions(),
      ]);
      const row = rows.find((candidate) => candidate.slug === server);
      if (
        !row ||
        !connectionTools(row).some((known) => known.name === tool) ||
        permissionOf(owner, server, tool) === "off"
      ) {
        return {
          content: `${server} ${tool} is not available to Code threads.`,
          isError: true,
        };
      }
      const result = await live().call(row.id, tool, input);
      return {
        content: textOf(result),
        ...(result.isError ? { isError: true } : {}),
      };
    },
  };
}

export async function claudeCodeSkills() {
  return (await reachedSkills("code-thread"))
    .filter((skill) => SKILL_NAME.test(skill.name))
    .map((skill) => ({
      name: skill.name,
      description: skill.description,
      body: skill.body,
      files: skillFiles(skill.files).map(({ path, content }) => ({
        path,
        content,
      })),
    }));
}

const REPO_SKILLS = [".agents/skills/*/SKILL.md", ".claude/skills/*/SKILL.md"];

async function repoSkills(cwd: string, sandbox: SandboxConnection) {
  const result = await sandbox.exec(
    `cd ${shQuote(cwd)} && for f in ${REPO_SKILLS.join(" ")}; do [ -f "$f" ] && printf '\\0%s\\n' "$f" && head -c 4000 "$f"; done; true`,
    { timeoutMs: 15_000 },
  );
  return result.stdout
    .toString()
    .split("\0")
    .map((chunk) => skillHeading(chunk.slice(chunk.indexOf("\n") + 1)))
    .filter((skill) => skill !== undefined);
}

export async function nativeSkills(cwd: string, sandbox: SandboxConnection | undefined) {
  const shared = (await reachedSkills("code-thread")).map(({ name, description }) => ({
    name,
    description,
  }));
  const repo = sandbox ? await repoSkills(cwd, sandbox) : [];
  const names = new Set(shared.map((skill) => skill.name));
  return [...shared, ...repo.filter((skill) => !names.has(skill.name))];
}
