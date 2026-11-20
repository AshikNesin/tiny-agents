export const JOB_STATES = {
  CREATED: "created",
  ACTIVE: "active",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
} as const;

export type JobState = (typeof JOB_STATES)[keyof typeof JOB_STATES];

export const VALID_JOB_STATES: readonly JobState[] = Object.values(JOB_STATES);

export function isValidJobState(state: string): state is JobState {
  return (VALID_JOB_STATES as readonly string[]).includes(state);
}

export function isTerminalJobState(state: JobState): boolean {
  return state === "completed" || state === "failed" || state === "cancelled";
}

export type JobAction = "retry" | "rerun" | "resume" | "cancel" | "delete";

export const JOB_ACTIONS: Readonly<Record<JobAction, readonly JobState[]>> = {
  retry: ["failed", "cancelled"],
  rerun: ["completed", "failed"],
  resume: ["cancelled"],
  cancel: ["created", "active"],
  delete: VALID_JOB_STATES,
};

export function canApplyJobAction(action: JobAction, state: JobState): boolean {
  return JOB_ACTIONS[action].includes(state);
}

export function allowedJobActions(state: JobState): JobAction[] {
  return (Object.keys(JOB_ACTIONS) as JobAction[]).filter((action) =>
    canApplyJobAction(action, state),
  );
}
