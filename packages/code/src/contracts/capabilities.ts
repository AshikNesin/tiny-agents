import type { PermissionMode } from "./threads";

export type RecoveryAction = "retry" | "resume" | "continue";

export interface Capabilities {
  turns: {
    interrupt: boolean;
    steer: boolean;
    queue: boolean;
    manageQueue: boolean;
    recovery: RecoveryAction[];
    compact: boolean;
  };
  threads: {
    fork: boolean;
    archive: boolean;
    delete: boolean;
    rename: boolean;
    changeCwd: boolean;
    subagents: boolean;
    search: boolean;
    discover: boolean;
  };
  settings: {
    modelSwitch: boolean;
    effortLevels: string[];
    permissionModes: PermissionMode[];
    defaultPermissionMode?: PermissionMode;
  };
  approvals: { tools: boolean; questions: boolean };
  workspace: {
    diffs: boolean;
    findFiles: boolean;
    uploads: boolean;
    skills: boolean;
    browse: boolean;
    worktrees: boolean;
    requiresCwd: boolean;
  };
  extras: {
    jobs: boolean;
    usageReport: boolean;
    commands: boolean;
  };
}

export const NO_CAPABILITIES: Capabilities = {
  turns: {
    interrupt: false,
    steer: false,
    queue: false,
    manageQueue: false,
    recovery: [],
    compact: false,
  },
  threads: {
    fork: false,
    archive: false,
    delete: false,
    rename: false,
    changeCwd: false,
    subagents: false,
    search: false,
    discover: false,
  },
  settings: { modelSwitch: false, effortLevels: [], permissionModes: [] },
  approvals: { tools: false, questions: false },
  workspace: {
    diffs: false,
    findFiles: false,
    uploads: false,
    skills: false,
    browse: false,
    worktrees: false,
    requiresCwd: false,
  },
  extras: { jobs: false, usageReport: false, commands: false },
};
