import { defineExtension, section } from "@earendil-works/pi-durable";
import { createToolSearchExtension } from "@earendil-works/pi-durable/tool-search";
import type { Extension } from "@earendil-works/pi-durable";

export type ToolPermission = "allow" | "ask" | "off";

export interface ToolInfo {
  name: string;
  label: string;
  askLabel?: string;
  description: string;
  readOnly?: boolean;
  allowByDefault?: boolean;
  askOnly?: boolean;
  unattendedOnly?: boolean;
  chatOnly?: boolean;
  vault?: boolean;
}

type CapabilityKind = "toolkit" | "skills" | "connection";

export interface CapabilityInfo {
  id: string;
  kind: CapabilityKind;
  name: string;
  description: string;
  tools: ToolInfo[];
  setupHint?: string;
  auto?: boolean;
  shared?: boolean;
}

export interface Capability extends CapabilityInfo {
  extension: Extension;
}

export interface CapabilitySelection {
  enabled: string[];
  permissions: Record<string, ToolPermission>;
  autoReview?: boolean;
  unattended?: boolean;
  budgetTokens?: number;
}

export function defaultPermission(tool: ToolInfo): ToolPermission {
  if (tool.askOnly) return "ask";
  return tool.readOnly || tool.allowByDefault ? "allow" : "ask";
}

export function hiddenWhere(
  tool: ToolInfo,
  selection: { unattended?: boolean } | undefined,
): boolean {
  return selection?.unattended === true
    ? tool.chatOnly === true || tool.askOnly === true
    : tool.unattendedOnly === true;
}

export function effectivePermission(
  tool: ToolInfo,
  permissions: Record<string, ToolPermission>,
): ToolPermission {
  const chosen = permissions[tool.name] ?? defaultPermission(tool);
  return chosen === "allow" && tool.askOnly ? "ask" : chosen;
}

function toolNames(names: string[], max: number): string {
  const prefix = /^mcp__.+?__/.exec(names[0] ?? "")?.[0];
  const shared = prefix !== undefined && names.every((name) => name.startsWith(prefix));
  const shown = names.slice(0, max).map((name) => (shared ? name.slice(prefix.length) : name));
  const more = names.length > max ? `, and ${names.length - max} more` : "";
  return `${shared ? `Tools (each named ${prefix}<name>)` : "Tools"}: ${shown.join(", ")}${more}`;
}

const LISTED_TOOLS_MAX = 40;

const LISTED_SHARED_TOOLS_MAX = 8;

export const TOOL_SEARCH_CAPABILITY = "tool-search";

export function createToolSearchCapability(
  describe: (id: string) => CapabilityInfo | undefined = () => undefined,
): Capability {
  const extension = createToolSearchExtension();
  const groups = section("deferred_tools", (input) => {
    const deferred = new Set(
      [...input.agent.tools, ...input.agent.deferred]
        .filter((tool) => tool.deferred === true)
        .map((tool) => tool.name),
    );
    if (deferred.size === 0) return undefined;
    const lines: string[] = [];
    for (const group of input.agent.extensions) {
      const names = (group.tools ?? [])
        .map((tool) => tool.name)
        .filter((name) => deferred.has(name));
      const count = names.length;
      if (count === 0) continue;
      const info = describe(group.name);
      const about = !info
        ? ""
        : info.kind === "connection"
          ? `: ${info.name}, a connection. ${toolNames(names, info.shared ? LISTED_SHARED_TOOLS_MAX : LISTED_TOOLS_MAX)}`
          : `: ${info.name}. ${info.description}`;
      lines.push(`- ${group.name} (${count} tool${count === 1 ? "" : "s"})${about}`);
    }
    if (lines.length === 0) return undefined;
    return [
      "These tool groups are not loaded yet. Load one with tool_search before you use it: the group's name as the query and its tool count as the limit loads the whole group, and a few words of what you need load only the matching tools. Loaded tools stay loaded.",
      ...lines,
    ].join("\n");
  });
  return {
    id: TOOL_SEARCH_CAPABILITY,
    kind: "toolkit",
    name: "Tool search",
    description: "Loads deferred tools on demand",
    auto: true,
    extension: defineExtension({
      ...extension,
      name: TOOL_SEARCH_CAPABILITY,
      sections: [...(extension.sections ?? []), groups],
    }),
    tools: [
      {
        name: "tool_search",
        label: "Searched tools",
        askLabel: "search tools",
        description: "Load deferred tools",
        readOnly: true,
      },
    ],
  };
}

export function capabilityInfo(capability: Capability): CapabilityInfo {
  const { extension: _extension, ...info } = capability;
  return info;
}
