import type { Static, TSchema } from "typebox";
import {
  defineExtension,
  defineTool,
  type PromptSection,
  type ToolRegistration,
} from "@earendil-works/pi-durable";
import type { GateHooks } from "./approvals";
import type { Capability, ToolInfo } from "./capabilities";

interface ToolPolicy {
  readOnly?: boolean;
  allowByDefault?: boolean;
  askOnly?: boolean;
  unattendedOnly?: boolean;
  chatOnly?: boolean;
}

const POLICY_KEYS = [
  "readOnly",
  "allowByDefault",
  "askOnly",
  "unattendedOnly",
  "chatOnly",
] as const;

interface ToolDeclaration<TParameters extends TSchema> {
  name: string;
  label: string;
  askLabel: string;
  summary: string;
  description: string;
  policy?: ToolPolicy;
  vault?: boolean;
  replay?: "safe" | "unsafe";
  parameters: TParameters;
  gate?: GateHooks<Static<TParameters>>;
  execute: ToolRegistration<TParameters>["execute"];
}

interface DeclaredTool {
  readonly info: ToolInfo;
  readonly registration: ToolRegistration;
}

export function tool<TParameters extends TSchema>(
  declaration: ToolDeclaration<TParameters>,
): DeclaredTool {
  const { name, label, askLabel, summary, description, policy = {}, vault } = declaration;
  const info: ToolInfo = { name, label, askLabel, description: summary };
  for (const key of POLICY_KEYS) {
    if (policy[key] !== undefined) info[key] = policy[key];
  }
  if (vault !== undefined) info.vault = vault;
  const { replay, parameters, gate, execute } = declaration;
  return {
    info,
    registration: defineTool({
      name,
      description,
      parameters,
      ...(replay ? { replay } : {}),
      execute,
      ...(gate ? { gate } : {}),
    }),
  };
}

interface ToolkitDeclaration {
  id: string;
  kind?: "toolkit" | "skills";
  name: string;
  description: string;
  auto?: boolean;
  tools?: readonly (DeclaredTool | false | undefined)[];
  offered?: (name: string) => boolean;
  sections?: readonly PromptSection[];
  deferred?: boolean;
  setupHint?: string;
}

export function defineToolkit(declaration: ToolkitDeclaration): Capability {
  const { id, kind = "toolkit", name, description, auto, offered = () => true } = declaration;
  const { sections, setupHint, deferred } = declaration;
  const tools = (declaration.tools ?? []).filter((declared): declared is DeclaredTool =>
    Boolean(declared),
  );
  return {
    id,
    kind,
    name,
    description,
    ...(auto !== undefined ? { auto } : {}),
    extension: defineExtension({
      name: id,
      ...(declaration.tools
        ? {
            tools: tools
              .filter((t) => offered(t.info.name))
              .map((t) => (deferred ? { ...t.registration, deferred: true } : t.registration)),
          }
        : {}),
      ...(sections ? { sections } : {}),
    }),
    tools: tools.map((t) => t.info),
    ...(setupHint !== undefined ? { setupHint } : {}),
  };
}
