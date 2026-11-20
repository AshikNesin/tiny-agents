import { config } from "@groot/core/config";

export function defaultJobOptions() {
  return {
    retryLimit: config.jobs.retryLimit,
    retryDelaySeconds: config.jobs.retryDelaySeconds,
    priority: 0,
  };
}
