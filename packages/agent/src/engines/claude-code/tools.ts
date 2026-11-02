/**
 * The tools a Claude plan conversation may ask for. They are described to
 * Claude Code as MCP proxy tools. Execution stays in tiny-agents, after the
 * approval gate. Claude Code's own tools stay empty.
 */
import type { ToolSpec } from "@tiny-agents/claude-worker";
import { effectivePermission, type Capability, type CapabilitySelection } from "../../capabilities";
import type { ToolPermissionChoice } from "./approvals";

export interface ClaudeToolRunner {
  execute?: (
    args: Record<string, unknown>,
    api: unknown,
    context: unknown,
  ) => Promise<{ output?: { type?: string; text?: string }[]; isError?: boolean }>;
}

export interface ClaudeToolSurface {
  tools: ToolSpec[];
  permissions: Record<string, ToolPermissionChoice>;
  runners: Map<string, ClaudeToolRunner>;
}

interface LooseTool extends ClaudeToolRunner {
  name: string;
  description?: string;
  parameters?: {
    type?: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

export function claudeToolSurface(
  catalog: ReadonlyMap<string, Capability>,
  selection: CapabilitySelection | undefined,
): ClaudeToolSurface {
  const tools: ToolSpec[] = [];
  const permissions: Record<string, ToolPermissionChoice> = {};
  const runners = new Map<string, ClaudeToolRunner>();
  const enabled = selection ? new Set(selection.enabled) : undefined;
  for (const capability of catalog.values()) {
    if (enabled && !enabled.has(capability.id)) continue;
    const declared = (capability.extension as { tools?: readonly LooseTool[] }).tools ?? [];
    for (const info of capability.tools) {
      const permission: ToolPermissionChoice = selection
        ? effectivePermission(info, selection.permissions)
        : "ask";
      permissions[info.name] = permission;
      if (permission === "off") continue;
      if (info.unattendedOnly && !selection?.unattended) continue;
      const registration = declared.find((tool) => tool.name === info.name);
      const parameters = registration?.parameters;
      tools.push({
        name: info.name,
        description: info.description,
        inputSchema:
          parameters && parameters.type === "object"
            ? {
                type: "object",
                ...(parameters.properties ? { properties: parameters.properties } : {}),
                ...(parameters.required ? { required: parameters.required } : {}),
              }
            : { type: "object", additionalProperties: true },
      });
      if (registration) runners.set(info.name, registration);
    }
  }
  return { tools, permissions, runners };
}

/** A tool api that fails clearly when a pi-only tool touches the harness. */
export function claudeToolApi(name: string): unknown {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        throw new Error(
          `${name} needs the pi runtime (${String(prop)}). The Claude plan engine does not run that tool.`,
        );
      },
    },
  );
}
