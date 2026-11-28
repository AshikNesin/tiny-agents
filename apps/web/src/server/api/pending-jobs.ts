import { HttpError } from "@groot/core/errors";
import { cancelJob } from "@groot/jobs/server/queue";

const SETTLED_CODES: ReadonlySet<string> = new Set(["JOB_NOT_FOUND", "JOB_ACTION_NOT_ALLOWED"]);

function ignoreJobAlreadySettled(error: unknown): void {
  if (error instanceof HttpError && SETTLED_CODES.has(error.code)) return;
  throw error;
}

export async function cancelPendingJob(jobId: string): Promise<void> {
  await cancelJob(jobId).catch(ignoreJobAlreadySettled);
}
