/**
 * Capabilities: what a bot can be given (issue #1 D2). A capability is one
 * pi-durable extension plus the metadata the app shows for it — a built-in
 * toolkit (`tasks`, `web`, `browser`), the bot's skills, or a remote MCP
 * connection. The app gives every bot every built-in toolkit; the owner
 * shapes a bot with a permission per tool (D3): `allow` runs it, `ask` waits
 * for the owner's approval, `off` removes it from the model.
 */
import { defineExtension } from "@earendil-works/pi-durable";
import { createToolSearchExtension } from "@earendil-works/pi-durable/tool-search";
import type { Extension } from "@earendil-works/pi-durable";

export type ToolPermission = "allow" | "ask" | "off";

export interface ToolInfo {
  name: string;
  /** Past-tense label for the transcript ("Searched the web"). */
  label: string;
  /**
   * Imperative, lowercase phrase that completes "<bot> wants to …" on an
   * approval card ("search the web"); the bot editor capitalizes it for the
   * tool's row. Every built-in tool has one; connection tools fall back to
   * "use <label>".
   */
  askLabel?: string;
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
  /**
   * Switched on and off by the app itself (by model or by connection), never
   * a choice in a bot's settings.
   */
  auto?: boolean;
}

export interface Capability extends CapabilityInfo {
  extension: Extension;
}

/** A bot's selection: enabled capability ids and per-tool overrides. */
export interface CapabilitySelection {
  enabled: string[];
  /** Tool name → permission; tools without an entry use their default. */
  permissions: Record<string, ToolPermission>;
  /** Auto-review (issue #65): a classifier may approve `ask` calls before the owner is asked. */
  autoReview?: boolean;
  /**
   * Nobody watches this conversation (a routine's, issue #63): a call that
   * would ask the owner is refused instead, and auto-review never runs.
   */
  unattended?: boolean;
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
    auto: true,
    extension: defineExtension({ ...createToolSearchExtension(), name: "tool-search" }),
    tools: [
      {
        name: "tool_search",
        label: "Searched tools",
        askLabel: "search tools",
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
