import { z } from "zod";

const MAX_RETRIES = 100;
export const MAX_JOB_LOGS = 500;
const MAX_DELAY_SECONDS = 365 * 24 * 60 * 60;
const MAX_PRIORITY = 1_000_000;
const MAX_BULK_RERUN = 500;

const seconds = z.coerce.number().int().min(0).max(MAX_DELAY_SECONDS);

const sendOptionsSchema = z
  .object({
    retryLimit: z.coerce.number().int().min(0).max(MAX_RETRIES).optional(),
    retryDelaySeconds: seconds.optional(),
    priority: z.coerce.number().int().min(-MAX_PRIORITY).max(MAX_PRIORITY).optional(),
    delaySeconds: seconds.optional(),
    singletonKey: z.string().min(1).optional(),
  })
  .optional();

const scheduleOptionsSchema = z.object({ timezone: z.string().min(1).optional() }).optional();

export const createJobSchema = z.object({
  jobName: z.string().min(1),
  data: z.unknown().optional(),
  options: sendOptionsSchema,
});

export const scheduleJobSchema = z.object({
  jobName: z.string().min(1),
  cron: z.string().min(1),
  data: z.unknown().optional(),
  options: scheduleOptionsSchema,
});

export const bulkRerunSchema = z.object({
  jobIds: z.array(z.string().min(1)).min(1).max(MAX_BULK_RERUN),
});

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const getJobsSchema = paginationQuerySchema.extend({
  state: z.string().optional(),
  name: z.string().optional(),
  search: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

export const getLogsQuerySchema = z.object({
  afterId: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_JOB_LOGS).optional(),
});
