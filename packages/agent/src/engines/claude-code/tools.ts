import type { Context } from "@earendil-works/chord/context";
import type { JsonValue } from "@earendil-works/chord/json";
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
  hiddenWhere,
  type Capability,
  type CapabilitySelection,
  type ToolPermission,
} from "../../capabilities";
import { toJson } from "../../durable-json";

export interface ClaudeToolSurface {
  tools: ToolSpec[];
  permissions: Record<string, ToolPermission>;
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
      if (hiddenWhere(info, selection)) continue;
      const registration = declared.find((tool) => tool.name === info.name);
      if (!registration) continue;
      if (registration.name === TOOL_SEARCH_TOOL_NAME) continue;
      const parameters = registration.parameters as
        | {
            type?: string;
            properties?: Record<string, unknown>;
            required?: string[];
          }
        | undefined;
      tools.push({
        name: info.name,
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

export function claudeToolApi(options: {
  name: string;
  conversation: number;
  task: number;
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
  const own: Pick<
    ToolExecutionApi,
    "conversationId" | "taskId" | "wake" | "checkpoint" | "memo" | "snapshot" | "details"
  > = {
    conversationId: options.conversation as ConversationId,
    taskId: options.task as TaskId,
    wake: undefined,
    checkpoint: undefined,
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
