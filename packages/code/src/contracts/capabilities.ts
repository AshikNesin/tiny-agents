/**
 * What a harness really does. The UI reads capabilities, never the harness
 * kind: a missing capability hides its control. A capability that is on but
 * fails at runtime is a driver bug (and never faked: a harness without
 * approvals gets no approval card, it does not get one answered for it).
 */
import type { PermissionMode } from "./threads";

export type RecoveryAction = "retry" | "resume" | "continue";

export interface Capabilities {
  turns: {
    interrupt: boolean;
    /** A message sent while a turn runs is injected into it. */
    steer: boolean;
    /** A message can be held until the running turn ends. */
    queue: boolean;
    /** Queued messages can be listed, sent now and cancelled. */
    manageQueue: boolean;
    /** Ways back from an error or a cut-off turn. */
    recovery: RecoveryAction[];
    /** `/compact` (or equivalent) frees context. */
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
    /** Threads started outside tiny-agents appear in the list. */
    discover: boolean;
  };
  settings: {
    modelSwitch: boolean;
    /** Effort / thinking levels the harness accepts; empty = none. */
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
    /** `cwd` is required to start a thread. */
    requiresCwd: boolean;
  };
  extras: {
    jobs: boolean;
    usageReport: boolean;
    /** Slash commands the composer hints. */
    commands: boolean;
  };
}

/** Every capability off: drivers spread this and turn on what they do. */
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
