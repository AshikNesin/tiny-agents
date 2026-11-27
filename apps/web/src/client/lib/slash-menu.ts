import type { ToolChoice } from "@tiny-agents/code/contracts";
import { connectionPick } from "../../shared/tool-picks";

export type SlashKind = "command" | "skill" | "connection" | "tool";

export interface SlashEntry {
  kind: SlashKind;
  value: string;
  label: string;
  detail: string;
}

interface SlashSources {
  commands?: readonly { command: string; hint: string }[];
  skills?: readonly { name: string; description?: string }[];
  tools?: readonly ToolChoice[];
  picked?: readonly string[];
}

const TOOLS_SHOWN_MAX = 20;

function toolKey(tool: ToolChoice): string {
  return tool.name.slice(`mcp__${tool.connection.slug}__`.length).toLowerCase();
}

function connectionsOf(tools: readonly ToolChoice[]) {
  const bySlug = new Map<string, { slug: string; name: string; count: number }>();
  for (const tool of tools) {
    const known = bySlug.get(tool.connection.slug);
    if (known) known.count += 1;
    else bySlug.set(tool.connection.slug, { ...tool.connection, count: 1 });
  }
  return [...bySlug.values()];
}

export function slashEntries(query: string, sources: SlashSources): SlashEntry[] {
  const q = query.toLowerCase();
  const picked = new Set(sources.picked ?? []);
  const tools = sources.tools ?? [];
  const commands = (sources.commands ?? [])
    .filter((command) => command.command.slice(1).toLowerCase().startsWith(q))
    .map((command) => ({
      kind: "command" as const,
      value: command.command,
      label: command.command,
      detail: command.hint,
    }));
  const skills = (sources.skills ?? [])
    .filter((skill) => skill.name.toLowerCase().startsWith(q) && !picked.has(skill.name))
    .map((skill) => ({
      kind: "skill" as const,
      value: skill.name,
      label: skill.name,
      detail: skill.description ?? "",
    }));
  const connections = connectionsOf(tools)
    .filter(
      (connection) =>
        !picked.has(connectionPick(connection.slug)) &&
        (connection.slug.toLowerCase().startsWith(q) ||
          connection.name.toLowerCase().startsWith(q)),
    )
    .map((connection) => ({
      kind: "connection" as const,
      value: connectionPick(connection.slug),
      label: connection.slug,
      detail: `Every ${connection.name} tool (${connection.count})`,
    }));
  const single = q
    ? tools
        .filter(
          (tool) =>
            !picked.has(tool.name) &&
            !picked.has(connectionPick(tool.connection.slug)) &&
            (toolKey(tool).startsWith(q) ||
              tool.label.toLowerCase().startsWith(q) ||
              tool.connection.slug.toLowerCase().startsWith(q)),
        )
        .slice(0, TOOLS_SHOWN_MAX)
        .map((tool) => ({
          kind: "tool" as const,
          value: tool.name,
          label: tool.label,
          detail: [tool.connection.name, tool.description].filter(Boolean).join(" · "),
        }))
    : [];
  return [...commands, ...skills, ...connections, ...single];
}

export function toolPickLabel(value: string, tools: readonly ToolChoice[]): string {
  const tool = tools.find((candidate) => candidate.name === value);
  if (tool) return `${tool.connection.name}: ${tool.label}`;
  const connection = tools.find((candidate) => connectionPick(candidate.connection.slug) === value);
  if (connection) return `${connection.connection.name} (all tools)`;
  return value;
}

export function sentToolName(value: string): string {
  const match = /^mcp__(.+?)__(.+)$/.exec(value);
  if (!match) return value;
  return match[2] === "*" ? `${match[1]} (all tools)` : `${match[1]}: ${match[2]}`;
}
