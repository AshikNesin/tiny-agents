import { Hono } from "hono";
import type { AppEnv } from "@groot/core/types";
import { Boom } from "@groot/core/errors";
import { ok } from "@groot/core/utils/api-response.utils";
import { parseBody, parseQuery, parseStringParam } from "@groot/core/utils/controller.utils";
import * as queue from "./queue";
import * as queries from "./queries";
import {
  bulkRerunSchema,
  createJobSchema,
  editScheduledJobSchema,
  getJobsSchema,
  getLogsQuerySchema,
  paginationQuerySchema,
  scheduleJobSchema,
} from "./validation";

/** Admin API behind JWT: `/api/v1/jobs`. */
export const jobRoutes = new Hono<AppEnv>();

jobRoutes.post("/", async (c) => {
  const { jobName, data, options } = await parseBody(c, createJobSchema);
  const jobId = await queue.addJob(jobName, data, options);
  return ok(c, { jobId, jobName, data }, 201);
});

jobRoutes.post("/bulk-rerun", async (c) => {
  const { jobs } = await parseBody(c, bulkRerunSchema);
  return ok(c, await queue.rerunJobs(jobs));
});

// Schedules
jobRoutes.get("/schedule", async (c) => ok(c, await queries.getScheduledJobs()));

jobRoutes.post("/schedule", async (c) => {
  const { jobName, data, cron, options } = await parseBody(c, scheduleJobSchema);
  return ok(c, await queue.scheduleJob(jobName, data, cron, options), 201);
});

jobRoutes.put("/schedule/:jobName", async (c) => {
  const jobName = parseStringParam(c.req.param("jobName"), "jobName");
  const { cron, data, options } = await parseBody(c, editScheduledJobSchema);
  return ok(c, await queue.editScheduledJob(jobName, cron, data, options));
});

jobRoutes.delete("/schedule/:jobName", async (c) => {
  const jobName = parseStringParam(c.req.param("jobName"), "jobName");
  await queue.cancelScheduledJob(jobName);
  return ok(c, { success: true });
});

// Dashboard
jobRoutes.get("/stats", async (c) => ok(c, await queries.getQueueStats()));

jobRoutes.get("/available", async (c) => ok(c, { jobs: await queries.getAvailableQueues() }));

jobRoutes.get("/status/failed", async (c) => {
  const { limit } = parseQuery(c, paginationQuerySchema);
  return ok(c, await queries.getFailedJobs({ limit }));
});

jobRoutes.get("/state/:state", async (c) => {
  const state = parseStringParam(c.req.param("state"), "state");
  const { limit, offset } = parseQuery(c, paginationQuerySchema);
  return ok(c, await queries.getJobsByState({ state, limit, offset }));
});

jobRoutes.delete("/state/:state", async (c) => {
  const state = parseStringParam(c.req.param("state"), "state");
  return ok(c, { count: await queries.purgeJobsByState({ state }) });
});

jobRoutes.get("/", async (c) => ok(c, await queries.getJobs(parseQuery(c, getJobsSchema))));

// Single job
const target = (c: { req: { param(name: string): string | undefined } }) => ({
  queueName: parseStringParam(c.req.param("queueName"), "queueName"),
  jobId: parseStringParam(c.req.param("jobId"), "jobId"),
});

jobRoutes.get("/:queueName/:jobId", async (c) => {
  const job = await queries.getJobById(target(c));
  if (!job) throw Boom.notFound("Job not found");
  return ok(c, job);
});

jobRoutes.get("/:queueName/:jobId/logs", async (c) => {
  const { afterId } = parseQuery(c, getLogsQuerySchema);
  return ok(c, await queries.getJobLogs({ jobId: target(c).jobId, afterId }));
});

jobRoutes.delete("/:queueName/:jobId", async (c) => {
  await queue.deleteJob(target(c));
  return ok(c, { success: true });
});

jobRoutes.post("/:queueName/:jobId/retry", async (c) => {
  await queue.retryJob(target(c));
  return ok(c, { success: true });
});

jobRoutes.post("/:queueName/:jobId/cancel", async (c) => {
  await queue.cancelJob(target(c));
  return ok(c, { success: true });
});

jobRoutes.post("/:queueName/:jobId/resume", async (c) => {
  await queue.resumeJob(target(c));
  return ok(c, { success: true });
});

jobRoutes.post("/:queueName/:jobId/rerun", async (c) => {
  const { queueName } = target(c);
  const newJobId = await queue.rerunJob(target(c));
  return ok(c, { newJobId, queueName });
});
