import { NO_CAPABILITIES, type Capabilities } from "../../contracts";

export const SHELLEY_THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export const SLASH_COMMANDS = [
  { command: "/model", hint: "Show or switch the model and reasoning (e.g. /model sonnet high)" },
  { command: "/compact", hint: "Compact the context to free room" },
  { command: "/btw", hint: "Ask a side question without disturbing the turn" },
  { command: "/fork", hint: "Continue in a copy of this conversation" },
  { command: "/cwd", hint: "Change the working directory" },
  { command: "/new", hint: "Start a new conversation" },
  { command: "/help", hint: "List Shelley's commands" },
];

export const CAPABILITIES: Capabilities = {
  ...NO_CAPABILITIES,
  turns: {
    interrupt: true,
    steer: true,
    queue: true,
    manageQueue: true,
    recovery: ["retry", "resume", "continue"],
    compact: true,
  },
  threads: {
    fork: true,
    rewind: false,
    archive: true,
    delete: true,
    rename: true,
    changeCwd: true,
    subagents: true,
    search: true,
    discover: false,
  },
  settings: {
    modelSwitch: true,
    effortLevels: [...SHELLEY_THINKING_LEVELS],
    permissionModes: [],
  },
  approvals: { tools: false, questions: false },
  workspace: {
    diffs: true,
    findFiles: true,
    uploads: true,
    skills: true,
    browse: true,
    worktrees: true,
    requiresCwd: false,
  },
  extras: { jobs: true, usageReport: true, commands: true },
};
