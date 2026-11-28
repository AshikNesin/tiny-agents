import {
  CODING_EFFORT_LEVELS,
  CODING_PERMISSION_MODES,
  DEFAULT_CODING_PERMISSION_MODE,
  type CodingCatalog,
} from "@tiny-agents/claude-worker";
import {
  NO_CAPABILITIES,
  type Capabilities,
  type ModelOption,
  type SlashCommand,
} from "../../contracts";

export const CAPABILITIES: Capabilities = {
  ...NO_CAPABILITIES,
  turns: {
    interrupt: true,
    steer: true,
    queue: true,
    manageQueue: true,
    recovery: [],
    compact: true,
  },
  threads: {
    fork: true,
    rewind: false,
    archive: true,
    delete: false,
    rename: true,
    changeCwd: false,
    subagents: false,
    search: false,
    discover: false,
  },
  settings: {
    modelSwitch: true,
    effortLevels: [...CODING_EFFORT_LEVELS],
    permissionModes: [...CODING_PERMISSION_MODES],
    defaultPermissionMode: DEFAULT_CODING_PERMISSION_MODE,
  },
  approvals: { tools: true, questions: true },
  workspace: {
    diffs: true,
    findFiles: true,
    uploads: true,
    skills: false,
    browse: true,
    worktrees: false,
    requiresCwd: true,
  },
  extras: { jobs: false, usageReport: true, commands: true },
};

const DEFAULT_COMMANDS: SlashCommand[] = [
  { command: "/compact", hint: "Summarize the conversation to free context" },
  { command: "/init", hint: "Write a CLAUDE.md for this repository" },
  { command: "/review", hint: "Review the current changes" },
];

export function modelOptionsOf(catalog: CodingCatalog | undefined): ModelOption[] {
  const models = catalog?.models ?? [];
  return models.map((model) => ({
    id: model.value,
    label: model.displayName || model.value,
    ...(model.value === "default" ? { isDefault: true } : {}),
    ...(model.supportedEffortLevels?.length ? { supportsReasoning: true } : {}),
  }));
}

export function commandsOf(catalog: CodingCatalog | undefined): SlashCommand[] {
  const commands = catalog?.commands ?? [];
  if (commands.length === 0) return DEFAULT_COMMANDS;
  return commands.map((command) => ({
    command: `/${command.name}`,
    hint: command.description || command.argumentHint || "",
  }));
}
