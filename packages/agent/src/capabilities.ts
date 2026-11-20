/**
 * Capabilities: what a bot can be given (issue #1 D2). A capability is one
 * pi-durable extension plus the metadata the app shows for it — a built-in
 * toolkit (`tasks`, `web`, `browser`), the bot's skills, or a remote MCP
 * connection. The app gives every bot every built-in toolkit; the owner
 * shapes a bot with a permission per tool (D3): `allow` runs it, `ask` waits
 * for the owner's approval, `off` removes it from the model.
 */
import { defineExtension, section } from "@earendil-works/pi-durable";
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
  /**
   * An effectful tool that defaults to `allow` anyway, because asking would
   * defeat its purpose (`shelley_start`: the owner's coding agent takes the
   * work, and it is approval enough that the owner asked the bot for it).
   * The owner can still set it to Ask or Off.
   */
  allowByDefault?: boolean;
  /** Tools that can never run unattended (e.g. `save_skill`): `allow` is not offered. */
  askOnly?: boolean;
  /**
   * Offered only where nobody watches (a routine's conversation, issue #87),
   * e.g. `report_routine_blocked`: removed from the model in chats.
   */
  unattendedOnly?: boolean;
  /**
   * The tool can put a vault item's value somewhere (a sink, issue #56).
   * The pi gate tells a vault use per call from the sink's gate plan; the
   * Claude-plan engine has no plans, so YOLO mode keeps every call of a
   * flagged tool asking there.
   */
  vault?: boolean;
}

type CapabilityKind = "toolkit" | "skills" | "connection";

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
  /**
   * Token budget of the whole conversation (a routine run's, which starts
   * fresh every run): once the model has used this many tokens, tool calls
   * are refused so the run wraps up, and well past it the run is stopped.
   */
  budgetTokens?: number;
}

export function defaultPermission(tool: ToolInfo): ToolPermission {
  if (tool.askOnly) return "ask";
  return tool.readOnly || tool.allowByDefault ? "allow" : "ask";
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
 * The `tool_search` capability (pi's `deferred` exposure): deferred tools, a
 * large toolkit's or a large connection's, are not sent until the model loads
 * them with `tool_search`. Its section names each group that has deferred
 * tools, and a connection's tool names, so the model knows what it can load. The section lists loaded tools
 * too, so loading changes nothing in it and the prompt cache holds.
 *
 * `describe` looks up a group's capability (an extension name is its id).
 */
/**
 * A connection's tool names, so the model knows what it can search for
 * (Claude Code lists deferred MCP tools the same way). Their shared
 * `mcp__<slug>__` prefix is written once.
 */
function toolNames(names: string[]): string {
  const prefix = /^mcp__.+?__/.exec(names[0] ?? "")?.[0];
  if (!prefix || !names.every((name) => name.startsWith(prefix)))
    return `Tools: ${names.join(", ")}`;
  return `Tools (each named ${prefix}<name>): ${names.map((name) => name.slice(prefix.length)).join(", ")}`;
}

/** The tool search capability's id (and extension name). */
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
          ? `: ${info.name}, a connection. ${toolNames(names)}`
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
