/**
 * The tools a Claude plan conversation may ask for. They are described to
 * Claude Code as MCP proxy tools. Execution stays in tiny-agents, behind the
 * Tool gate. Claude Code's own tools stay empty.
 */
import type { Context, JsonValue } from "@earendil-works/chord";
import type {
  ConversationId,
  DocumentReader,
  TaskId,
  ToolExecutionApi,
  ToolRegistration,
} from "@earendil-works/pi-durable";
import { TOOL_SEARCH_TOOL_NAME } from "@earendil-works/pi-durable/tool-search";
import type { ToolSpec } from "@tiny-agents/claude-worker";
import {
  effectivePermission,
  type Capability,
  type CapabilitySelection,
  type ToolPermission,
} from "../../capabilities";
import { toJson } from "../../durable-json";

export interface ClaudeToolSurface {
  tools: ToolSpec[];
  /** Every enabled tool's permission; an `off` tool is not offered. */
  permissions: Record<string, ToolPermission>;
  /** The tools' registrations, by name: what runs once the gate lets a call through. */
  runners: Map<string, ToolRegistration>;
}

export function claudeToolSurface(
  catalog: ReadonlyMap<string, Capability>,
  selection: CapabilitySelection | undefined,
): ClaudeToolSurface {
  const tools: ToolSpec[] = [];
  const permissions: Record<string, ToolPermission> = {};
  const runners = new Map<string, ToolRegistration>();
  const enabled = selection ? new Set(selection.enabled) : undefined;
  for (const capability of catalog.values()) {
    if (enabled && !enabled.has(capability.id)) continue;
    const declared = capability.extension.tools ?? [];
    for (const info of capability.tools) {
      const permission: ToolPermission = selection
        ? effectivePermission(info, selection.permissions)
        : "ask";
      permissions[info.name] = permission;
      if (permission === "off") continue;
      if (info.unattendedOnly && !selection?.unattended) continue;
      // A tool its toolkit does not offer (not configured) has no registration:
      // it is listed for the owner's settings, never offered to the model.
      const registration = declared.find((tool) => tool.name === info.name);
      if (!registration) continue;
      // Deferred tools are offered directly: Claude Code defers MCP tools
      // itself, and tool_search loads through the pi runtime.
      if (registration.name === TOOL_SEARCH_TOOL_NAME) continue;
      const parameters = registration.parameters as
        | { type?: string; properties?: Record<string, unknown>; required?: string[] }
        | undefined;
      tools.push({
        name: info.name,
        // What the model reads, as a pi conversation gets it; `info.description`
        // is the owner's one-line summary.
        description: registration.description,
        inputSchema:
          parameters && parameters.type === "object"
            ? {
                type: "object",
                ...(parameters.properties ? { properties: parameters.properties } : {}),
                ...(parameters.required ? { required: parameters.required } : {}),
              }
            : { type: "object", additionalProperties: true },
      });
      runners.set(info.name, registration);
    }
  }
  return { tools, permissions, runners };
}

/**
 * The tool api a Claude plan call runs with. It has what the Tool gate and
 * plain tools need: the call's ids, decided-once memos (in memory: a Claude
 * call does not survive a restart), the conversation's documents in the
 * shared store (permissions, YOLO, vault grants), and the details the chat
 * shows. Anything else needs a pi-durable task and fails clearly.
 */
export function claudeToolApi(options: {
  name: string;
  conversation: number;
  task: number;
  /** The shared store's documents; without it, every document reads as absent. */
  docs?: Pick<DocumentReader, "snapshot">;
  details?: (value: JsonValue) => void;
}): ToolExecutionApi {
  const memos = new Map<string, JsonValue>();
  function memo<T extends JsonValue>(name: string, context: Context): Promise<T | undefined>;
  function memo<T extends JsonValue>(name: string, candidate: T, context: Context): Promise<T>;
  async function memo(name: string, ...rest: unknown[]) {
    if (rest.length >= 2 && !memos.has(name)) memos.set(name, toJson(rest[0]));
    return memos.get(name);
  }
  const own: Pick<ToolExecutionApi, "conversationId" | "taskId" | "memo" | "snapshot" | "details"> =
    {
      conversationId: options.conversation as ConversationId,
      taskId: options.task as TaskId,
      memo,
      snapshot: options.docs ? options.docs.snapshot.bind(options.docs) : async () => undefined,
      details: async (value) => {
        options.details?.(value);
      },
    };
  return new Proxy(own, {
    get(target, prop) {
      if (typeof prop === "symbol" || prop === "then") return undefined;
      if (prop in target) return Reflect.get(target, prop);
      throw new Error(
        `${options.name} needs the pi runtime (${prop}). The Claude plan engine does not run that tool.`,
      );
    },
  }) as ToolExecutionApi;
}
