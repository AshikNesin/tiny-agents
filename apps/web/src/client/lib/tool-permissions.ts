import type { CapabilityInfo, ToolPermission } from "../../shared/api/bots";
import { defaultPermission } from "@tiny-agents/agent/wire";

export type ToolInfo = CapabilityInfo["tools"][number];
export type Permissions = Record<string, ToolPermission>;

export function permissionOf(permissions: Permissions, tool: ToolInfo): ToolPermission {
  return permissions[tool.name] ?? defaultPermission(tool);
}

export function toolTitle(tool: ToolInfo): string {
  const text = tool.askLabel ?? tool.label;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function matchesQuery(tool: ToolInfo, toolkitName: string, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = [tool.name.replace(/_/g, " "), tool.label, tool.askLabel, tool.description]
    .concat(toolkitName)
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return words.every((word) => haystack.includes(word));
}

export function groupValue(permissions: Permissions, tools: ToolInfo[]): ToolPermission | "mixed" {
  const values = new Set(tools.map((tool) => permissionOf(permissions, tool)));
  return values.size === 1 ? [...values][0] : "mixed";
}

export function summary(permissions: Permissions, tools: ToolInfo[]): string {
  const counts: Record<ToolPermission, number> = { allow: 0, ask: 0, off: 0 };
  for (const tool of tools) counts[permissionOf(permissions, tool)] += 1;
  return (["allow", "ask", "off"] as const)
    .filter((key) => counts[key] > 0)
    .map((key) => `${counts[key]} ${key}`)
    .join(" · ");
}

export function setAll(
  permissions: Permissions,
  tools: ToolInfo[],
  value: ToolPermission,
): Permissions {
  const next = { ...permissions };
  for (const tool of tools) next[tool.name] = value === "allow" && tool.askOnly ? "ask" : value;
  return next;
}

export function applyPreset(
  permissions: Permissions,
  tools: ToolInfo[],
  preset: "read-only" | "ask-all",
): Permissions {
  const next = { ...permissions };
  for (const tool of tools)
    next[tool.name] = preset === "ask-all" ? "ask" : defaultPermission(tool);
  return next;
}

export const COLLAPSE_OVER = 8;
