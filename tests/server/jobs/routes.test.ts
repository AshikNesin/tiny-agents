import { beforeEach, describe, expect, it } from "vite-plus/test";
import { jobRunner, registerJobHandler, runTick } from "@groot/jobs/server";
import { api, createTestApp, signIn } from "../helpers";

const app = createTestApp();
let token: string;

beforeEach(async () => {
  jobRunner.reset();
  registerJobHandler("report", () => ({ ok: true }));
  if (!token) ({ token } = await signIn(app));
});

describe("jobs API", () => {
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
