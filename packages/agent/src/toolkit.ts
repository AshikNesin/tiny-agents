/**
 * One declaration per tool (rewrite step 3.1). A tool is declared once with
 * `tool()`: what the owner sees of it (its `ToolInfo`), what the model is
 * offered and runs (its pi-durable registration) and its say in the Tool
 * gate (`gate`, a typed field the gate reads). `defineToolkit()` turns a
 * toolkit's tools into the `Capability` the app installs: the tools' infos in
 * order, and an extension offering the same tools in the same order.
 */
import type { Static, TSchema } from "@earendil-works/pi-ai";
import {
  defineExtension,
  defineTool,
  type PromptSection,
  type ToolRegistration,
} from "@earendil-works/pi-durable";
import type { GateHooks } from "./approvals";
import type { Capability, ToolInfo } from "./capabilities";

/** How a tool's permission defaults and where it is offered (see `ToolInfo`). */
interface ToolPolicy {
  readOnly?: boolean;
  allowByDefault?: boolean;
  askOnly?: boolean;
  unattendedOnly?: boolean;
}

const POLICY_KEYS = ["readOnly", "allowByDefault", "askOnly", "unattendedOnly"] as const;

interface ToolDeclaration<TParameters extends TSchema> {
  name: string;
  /** Past-tense label for the transcript ("Searched the web"). */
  label: string;
  /** Completes "<bot> wants to …" on an approval card ("search the web"). */
  askLabel: string;
  /** What the owner reads of the tool in the bot's settings (`ToolInfo.description`). */
  summary: string;
  /** What the model reads of the tool. */
  description: string;
  policy?: ToolPolicy;
  /** The tool can put a vault item's value somewhere (`ToolInfo.vault`). */
  vault?: boolean;
  /**
   * Whether an interrupted call may run again after a restart. Left out, the
   * registration has no `replay` and pi-durable treats the tool as `unsafe`.
   */
  replay?: "safe" | "unsafe";
  parameters: TParameters;
  /** The tool's own say in its gate, decided once per call. */
  gate?: GateHooks<Static<TParameters>>;
  execute: ToolRegistration<TParameters>["execute"];
}

/** A declared tool: what the app shows of it and what pi-durable runs. */
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
  /** The extension name, stored per conversation by pi-durable. */
  id: string;
  /** Default `toolkit`; the bot's skills are a capability of their own kind. */
  kind?: "toolkit" | "skills";
  name: string;
  description: string;
  /** Switched on and off by the app itself, never a choice in a bot's settings. */
  auto?: boolean;
  /**
   * Listed in order; `false` or `undefined` is a tool this toolkit does not
   * have here. Left out, the toolkit only adds prompt sections.
   */
  tools?: readonly (DeclaredTool | false | undefined)[];
  /**
   * Which listed tools the model is offered (default: all). A toolkit that is
   * not configured still lists its tools, so the owner can set their
   * permissions, but offers the model none that could only fail.
   */
  offered?: (name: string) => boolean;
  sections?: readonly PromptSection[];
  /** Why the toolkit can't run yet; absent when it is ready. */
  setupHint?: string;
}

export function defineToolkit(declaration: ToolkitDeclaration): Capability {
  const { id, kind = "toolkit", name, description, auto, offered = () => true } = declaration;
  const { sections, setupHint } = declaration;
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
        ? { tools: tools.filter((t) => offered(t.info.name)).map((t) => t.registration) }
        : {}),
      ...(sections ? { sections } : {}),
    }),
    tools: tools.map((t) => t.info),
    ...(setupHint !== undefined ? { setupHint } : {}),
  };
}
