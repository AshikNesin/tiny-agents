/**
 * Capabilities: what a bot can be given (issue #1 D2). A capability is one
 * pi-durable extension plus the metadata the app shows for it — a built-in
 * toolkit (`tasks`, `web`, `time`), the bot's skills, or a remote MCP
 * connection. Every capability is off by default; each bot selects the ones
 * it may use and a permission per tool (D3): `allow` runs it, `ask` waits for
 * the owner's approval, `off` removes it from the model.
 */
import { defineExtension } from "@earendil-works/pi-durable";
import { createToolSearchExtension } from "@earendil-works/pi-durable/tool-search";
import type { Extension } from "@earendil-works/pi-durable";

export type ToolPermission = "allow" | "ask" | "off";

export interface ToolInfo {
  name: string;
  /** Past-tense label for the transcript ("Searched the web"). */
  label: string;
  description: string;
  /** Read-only tools default to `allow`; everything else to `ask`. */
  readOnly?: boolean;
  /** Tools that can never run unattended (e.g. `save_skill`): `allow` is not offered. */
  askOnly?: boolean;
}

export type CapabilityKind = "toolkit" | "skills" | "connection";

export interface CapabilityInfo {
  /** The extension name, stored per conversation by pi-durable ("tasks", "mcp:linear"). */
  id: string;
  kind: CapabilityKind;
  name: string;
  description: string;
  tools: ToolInfo[];
  /** Why the capability can't run yet (missing configuration); absent when ready. */
  setupHint?: string;
}

export interface Capability extends CapabilityInfo {
  extension: Extension;
}

/** A bot's selection: enabled capability ids and per-tool overrides. */
export interface CapabilitySelection {
  enabled: string[];
  /** Tool name → permission; tools without an entry use their default. */
  permissions: Record<string, ToolPermission>;
}

export function defaultPermission(tool: ToolInfo): ToolPermission {
  return tool.readOnly && !tool.askOnly ? "allow" : "ask";
}

/** The permission a tool runs with for a selection (`askOnly` tools never resolve to `allow`). */
export function effectivePermission(
  tool: ToolInfo,
  permissions: Record<string, ToolPermission>,
): ToolPermission {
  const chosen = permissions[tool.name] ?? defaultPermission(tool);
  return chosen === "allow" && tool.askOnly ? "ask" : chosen;
}

/**
 * The `tool_search` capability: installs alongside a connection with deferred
 * tools, letting the model discover them instead of being offered all of them.
 */
export function createToolSearchCapability(): Capability {
  return {
    id: "tool-search",
    kind: "toolkit",
    name: "Tool search",
    description: "Finds tools of large connections on demand",
    extension: defineExtension({ ...createToolSearchExtension(), name: "tool-search" }),
    tools: [
      {
        name: "tool_search",
        label: "Searched tools",
        description: "Find tools of large connections",
        readOnly: true,
      },
    ],
  };
}

export function capabilityInfo(capability: Capability): CapabilityInfo {
  const { extension: _extension, ...info } = capability;
  return info;
}
