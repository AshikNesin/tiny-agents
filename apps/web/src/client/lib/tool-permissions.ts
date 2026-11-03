/**
 * The Tools tab's permission model (issue #91): a bot's per-tool Allow / Ask /
 * Off choices, read and set per tool, per toolkit, or for every tool at once.
 * A tool without a stored choice uses its default.
 */
import type { CapabilityInfo, ToolPermission } from "./bots-api";

export type ToolInfo = CapabilityInfo["tools"][number];
export type Permissions = Record<string, ToolPermission>;

/**
 * Read-only tools run unattended; anything that changes something asks,
 * unless its toolkit marks it `allowByDefault` (the Shelley hand-off).
 */
export function defaultPermission(tool: ToolInfo): ToolPermission {
  if (tool.askOnly) return "ask";
  return tool.readOnly || tool.allowByDefault ? "allow" : "ask";
}

export function permissionOf(permissions: Permissions, tool: ToolInfo): ToolPermission {
  return permissions[tool.name] ?? defaultPermission(tool);
}

/** What the tool does, as an action ("Open a page"), else its activity label. */
export function toolTitle(tool: ToolInfo): string {
  const text = tool.askLabel ?? tool.label;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A tool matches when every word of the query is in its name, title, description or toolkit. */
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

/** The toolkit's shared permission, or "mixed" when its tools differ. */
export function groupValue(permissions: Permissions, tools: ToolInfo[]): ToolPermission | "mixed" {
  const values = new Set(tools.map((tool) => permissionOf(permissions, tool)));
  return values.size === 1 ? [...values][0] : "mixed";
}

/** "3 allow · 5 ask · 1 off", leaving out the empty counts. */
export function summary(permissions: Permissions, tools: ToolInfo[]): string {
  const counts: Record<ToolPermission, number> = { allow: 0, ask: 0, off: 0 };
  for (const tool of tools) counts[permissionOf(permissions, tool)] += 1;
  return (["allow", "ask", "off"] as const)
    .filter((key) => counts[key] > 0)
    .map((key) => `${counts[key]} ${key}`)
    .join(" · ");
}

/** Set every tool to `value`; an Ask (always) tool can't be allowed, so it asks. */
export function setAll(
  permissions: Permissions,
  tools: ToolInfo[],
  value: ToolPermission,
): Permissions {
  const next = { ...permissions };
  for (const tool of tools) next[tool.name] = value === "allow" && tool.askOnly ? "ask" : value;
  return next;
}

/** Presets: read-only tools allowed and the rest asking, or everything asking. */
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

/** Groups with more tools than this start collapsed. */
export const COLLAPSE_OVER = 8;
