import type { JobHandler } from "./types";
import { jobRunner } from "./tick";

export function registerJobHandler<T, R = unknown>(name: string, handler: JobHandler<T, R>): void {
  jobRunner.register(name, handler);
}

export function getRegisteredHandlers(): string[] {
  return jobRunner.handlerNames();
}

export function getJobHandler(name: string): JobHandler | undefined {
  return jobRunner.handler(name);
}

/**
 * @deprecated Use `jobRunner.reset()`, which also clears the rest of the runner state (poll timer,
 * pending re-run, housekeeping schedule).
 */
export function clearJobHandlers(): void {
  jobRunner.reset();
}

export function startWorkers(): Promise<void> {
  return jobRunner.start();
}

export function stopWorkers(): Promise<void> {
  return jobRunner.stop();
}
