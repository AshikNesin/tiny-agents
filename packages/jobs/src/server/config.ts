import { config } from "@groot/core/config";

/** Defaults applied by `addJob()`; read lazily so app config overrides apply. */
export function defaultJobOptions() {
  return {
    retryLimit: config.jobs.retryLimit,
    retryDelaySeconds: config.jobs.retryDelaySeconds,
    priority: 0,
  };
}

export const jobConfig = {
  get enabled() {
    return config.jobs.enabled;
  },
  get pollIntervalSeconds() {
    return config.jobs.pollIntervalSeconds;
  },
  get batchSize() {
    return config.jobs.batchSize;
  },
  get activeTimeoutSeconds() {
    return config.jobs.activeTimeoutSeconds;
  },
  get keepCompletedDays() {
    return config.jobs.keepCompletedDays;
  },
  get runInline() {
    return config.jobs.runInline;
  },
};
