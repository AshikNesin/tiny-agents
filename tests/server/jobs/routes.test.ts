import { beforeEach, describe, expect, it } from "vite-plus/test";
import { db } from "@groot/core/database";
import { jobRunner, jobs, registerJobHandler, runTick } from "@groot/jobs/server";
import { api, createTestApp, signIn } from "../helpers";

const app = createTestApp();
let token: string;

let memberToken: string;

beforeEach(async () => {
  jobRunner.reset();
  await db.delete(jobs);
  registerJobHandler("report", () => ({ ok: true }));
  if (!token) ({ token } = await signIn(app, { isAdmin: true }));
  memberToken ??= (await signIn(app)).token;
});

describe("jobs API", () => {
  it("is an admin API: a signed-in non-admin gets 403 on every route", async () => {
    const jobId = (
      await api<{ jobId: string }>(app, "/api/v1/jobs", {
        method: "POST",
        json: { jobName: "report" },
        token,
      })
    ).body.data!.jobId;
    await api(app, "/api/v1/jobs/schedule", {
      method: "POST",
      json: { jobName: "report", cron: "0 9 * * *" },
      token,
    });

    const as = (method: string, path: string, json?: unknown) =>
      api(app, path, { method, json, token: memberToken });
    const refused = [
      await as("GET", "/api/v1/jobs"),
      await as("GET", "/api/v1/jobs/stats"),
      await as("GET", "/api/v1/jobs/available"),
      await as("GET", "/api/v1/jobs/schedule"),
      await as("GET", `/api/v1/jobs/${jobId}`),
      await as("GET", `/api/v1/jobs/${jobId}/logs`),
      await as("POST", "/api/v1/jobs", { jobName: "report" }),
      await as("POST", "/api/v1/jobs/bulk-rerun", { jobIds: [jobId] }),
      await as("POST", "/api/v1/jobs/schedule", { jobName: "report", cron: "0 9 * * *" }),
      await as("DELETE", "/api/v1/jobs/schedule/report"),
      await as("DELETE", "/api/v1/jobs/state/created"),
      await as("DELETE", `/api/v1/jobs/${jobId}`),
      await as("POST", `/api/v1/jobs/${jobId}/retry`),
      await as("POST", `/api/v1/jobs/${jobId}/cancel`),
      await as("POST", `/api/v1/jobs/${jobId}/resume`),
      await as("POST", `/api/v1/jobs/${jobId}/rerun`),
    ];
    for (const res of refused) expect(res.status).toBe(403);

    const stats = await api<Record<string, number>>(app, "/api/v1/jobs/stats", { token });
    expect(stats.body.data).toMatchObject({ created: 1, cancelled: 0 });
    expect(
      (await api<Array<{ name: string }>>(app, "/api/v1/jobs/schedule", { token })).body.data,
    ).toHaveLength(1);

    await api(app, "/api/v1/jobs/schedule/report", { method: "DELETE", token });
    await api(app, `/api/v1/jobs/${jobId}`, { method: "DELETE", token });
  });

  it("validates payloads", async () => {
    expect(
      (await api(app, "/api/v1/jobs", { method: "POST", json: { jobName: "" }, token })).status,
    ).toBe(400);
    expect((await api(app, "/api/v1/jobs", { method: "POST", json: {}, token })).status).toBe(400);
    expect(
      (
        await api(app, "/api/v1/jobs/schedule", {
          method: "POST",
          json: { jobName: "report" },
          token,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await api(app, "/api/v1/jobs/schedule", {
          method: "POST",
          json: { jobName: "report", cron: "bad" },
          token,
        })
      ).status,
    ).toBe(400);
    expect(
      (await api(app, "/api/v1/jobs/bulk-rerun", { method: "POST", json: { jobIds: [] }, token }))
        .status,
    ).toBe(400);
    expect((await api(app, "/api/v1/jobs?state=bogus", { token })).status).toBe(400);

    expect((await api(app, "/api/v1/jobs?limit=10&offset=5", { token })).status).toBe(200);
    expect((await api(app, "/api/v1/jobs?limit=0", { token })).status).toBe(400);

    const coerced = await api<{ jobId: string }>(app, "/api/v1/jobs", {
      method: "POST",
      json: { jobName: "report", options: { retryLimit: "2" } },
      token,
    });
    expect(coerced.status).toBe(201);
    const coercedJob = await api<{ retryLimit: number }>(
      app,
      `/api/v1/jobs/${coerced.body.data!.jobId}`,
      { token },
    );
    expect(coercedJob.body.data?.retryLimit).toBe(2);

    await api(app, `/api/v1/jobs/${coerced.body.data!.jobId}`, { method: "DELETE", token });
    expect(
      (
        await api(app, "/api/v1/jobs", {
          method: "POST",
          json: { jobName: "report", options: { retryLimit: -1 } },
          token,
        })
      ).status,
    ).toBe(400);
  });

  it("refuses options with no upper bound, which could grow or stall the queue", async () => {
    const within: Record<string, number> = {
      retryLimit: 100,
      retryDelaySeconds: 1000,
      priority: 1_000_000,
      delaySeconds: 1000,
    };
    const beyond: Record<string, number>[] = [
      { retryLimit: 101 },
      { retryLimit: 1_000_000 },
      { retryDelaySeconds: 31_536_001 },
      { delaySeconds: 31_536_001 },
      { delaySeconds: 1e15 },
      { priority: 1_000_001 },
      { priority: -1_000_001 },
    ];
    const create = (options: Record<string, number>) =>
      api(app, "/api/v1/jobs", { method: "POST", json: { jobName: "report", options }, token });

    expect((await create(within)).status).toBe(201);
    try {
      for (const option of beyond) {
        const res = await create(option);
        expect(res.status, JSON.stringify(option)).toBe(400);

        const field = `options.${Object.keys(option)[0]!}`;
        expect(res.body.error?.details, JSON.stringify(option)).toHaveProperty(field);
      }
    } finally {
      await api(app, "/api/v1/jobs/state/created", { method: "DELETE", token });
    }
  });

  it("bounds how many jobs one bulk-rerun may name", async () => {
    const ids = Array.from({ length: 501 }, () => crypto.randomUUID());
    const refused = await api(app, "/api/v1/jobs/bulk-rerun", {
      method: "POST",
      json: { jobIds: ids },
      token,
    });
    expect(refused.status).toBe(400);
    expect(refused.body.error?.details).toHaveProperty("jobIds");

    const accepted = await api<Array<{ jobId: string; success: boolean }>>(
      app,
      "/api/v1/jobs/bulk-rerun",
      {
        method: "POST",
        json: { jobIds: ids.slice(0, 500) },
        token,
      },
    );
    expect(accepted.status).toBe(200);
    expect(accepted.body.data).toHaveLength(500);
  });

  it("creates, lists, inspects and acts on jobs", async () => {
    const created = await api<{ jobId: string }>(app, "/api/v1/jobs", {
      method: "POST",
      json: { jobName: "report", data: { week: 42 }, options: { retryLimit: 1 } },
      token,
    });
    expect(created.status).toBe(201);
    const jobId = created.body.data!.jobId;

    const stats = await api<Record<string, number>>(app, "/api/v1/jobs/stats", { token });
    expect(stats.body.data).toMatchObject({
      created: 1,
      active: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    });

    await runTick();

    const job = await api<{ state: string; output: unknown }>(app, `/api/v1/jobs/${jobId}`, {
      token,
    });
    expect(job.body.data).toMatchObject({ state: "completed", output: { ok: true } });
    const unknown = await api(app, "/api/v1/jobs/00000000-0000-0000-0000-000000000000", { token });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error?.code).toBe("JOB_NOT_FOUND");

    const logs = await api<Array<{ message: string }>>(app, `/api/v1/jobs/${jobId}/logs`, {
      token,
    });
    expect(logs.body.data?.map((l) => l.message)).toContain("Starting job report");

    const list = await api<{ jobs: Array<{ id: string }>; total: number }>(
      app,
      "/api/v1/jobs?state=completed&name=report",
      { token },
    );
    expect(list.body.data?.total).toBe(1);
    expect(
      (await api<{ jobs: string[] }>(app, "/api/v1/jobs/available", { token })).body.data?.jobs,
    ).toContain("report");

    const rerun = await api<{ newJobId: string }>(app, `/api/v1/jobs/${jobId}/rerun`, {
      method: "POST",
      token,
    });
    expect(rerun.status).toBe(200);
    const cancelled = await api(app, `/api/v1/jobs/${rerun.body.data!.newJobId}/cancel`, {
      method: "POST",
      token,
    });
    expect(cancelled.status).toBe(200);
    const cancelAgain = await api(app, `/api/v1/jobs/${rerun.body.data!.newJobId}/cancel`, {
      method: "POST",
      token,
    });
    expect(cancelAgain.status).toBe(400);

    const bulk = await api<Array<{ jobId: string; success: boolean; newJobId?: string }>>(
      app,
      "/api/v1/jobs/bulk-rerun",
      { method: "POST", json: { jobIds: [jobId, rerun.body.data!.newJobId] }, token },
    );
    expect(bulk.body.data).toMatchObject([
      { jobId, success: true, newJobId: expect.any(String) },
      { jobId: rerun.body.data!.newJobId, success: false },
    ]);

    const purged = await api<{ count: number }>(app, "/api/v1/jobs/state/cancelled", {
      method: "DELETE",
      token,
    });
    expect(purged.body.data).toEqual({ count: 1 });

    expect((await api(app, `/api/v1/jobs/${jobId}`, { method: "DELETE", token })).status).toBe(200);
    expect((await api(app, `/api/v1/jobs/${jobId}`, { token })).status).toBe(404);
  });

  it("manages schedules", async () => {
    const created = await api(app, "/api/v1/jobs/schedule", {
      method: "POST",
      json: { jobName: "report", cron: "0 9 * * *", data: { weekly: true } },
      token,
    });
    expect(created.status).toBe(201);
    const edited = await api(app, "/api/v1/jobs/schedule", {
      method: "POST",
      json: { jobName: "report", cron: "0 10 * * *", data: { weekly: false } },
      token,
    });
    expect(edited.body.data).toMatchObject({ cron: "0 10 * * *", data: { weekly: false } });
    expect(
      (
        await api(app, "/api/v1/jobs/schedule/report", {
          method: "PUT",
          json: { cron: "0 10 * * *" },
          token,
        })
      ).status,
    ).toBe(404);
    const list = await api<Array<{ name: string }>>(app, "/api/v1/jobs/schedule", { token });
    expect(list.body.data?.map((s) => s.name)).toEqual(["report"]);
    expect(
      (await api(app, "/api/v1/jobs/schedule/report", { method: "DELETE", token })).status,
    ).toBe(200);
    expect(
      (await api(app, "/api/v1/jobs/schedule/report", { method: "DELETE", token })).status,
    ).toBe(404);
  });
});
