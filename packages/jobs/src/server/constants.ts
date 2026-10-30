export const JOB_STATES = {
  CREATED: "created",
  ACTIVE: "active",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
} as const;

export type JobState = (typeof JOB_STATES)[keyof typeof JOB_STATES];

export const VALID_JOB_STATES: readonly JobState[] = Object.values(JOB_STATES);

/** Path segments under `/api/v1/jobs` that cannot be used as job names. */
export const RESERVED_QUEUE_NAMES = [
  "schedule",
  "stats",
  "available",
  "state",
  "status",
  "bulk-rerun",
] as const;

export function isValidJobState(state: string): state is JobState {
  return (VALID_JOB_STATES as readonly string[]).includes(state);
}

export function isReservedQueueName(name: string): boolean {
  return (RESERVED_QUEUE_NAMES as readonly string[]).includes(name);
}
