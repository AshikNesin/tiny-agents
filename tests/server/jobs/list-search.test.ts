import { beforeAll, describe, expect, it } from "vite-plus/test";
import { addJob, getJobs } from "@groot/jobs/server";
import { api, createTestApp, signIn } from "../helpers";

// This file's database is its own, so the counts below are exact.
const reportIds: string[] = [];
let invoiceId: string;

beforeAll(async () => {
  for (let i = 0; i < 5; i++) reportIds.push(await addJob("Weekly-Report", { i }));
  await addJob("cleanup", {});
  await addJob("50%_off", {});
  invoiceId = await addJob("invoice", {});
});

describe("job list search", () => {
  it("matches a substring of the name, case-insensitively", async () => {
    const result = await getJobs({ search: "weekly-rep" });
    expect(result.total).toBe(5);
    expect(new Set(result.jobs.map((job) => job.name))).toEqual(new Set(["Weekly-Report"]));
  });

  it("matches a substring of the id", async () => {
    const result = await getJobs({ search: invoiceId.slice(2, 10).toUpperCase() });
    expect(result.jobs.map((job) => job.id)).toEqual([invoiceId]);
    expect(result.total).toBe(1);
  });

  it("paginates the matches and counts all of them in total", async () => {
    const pages = await Promise.all(
      [0, 2, 4].map((offset) => getJobs({ search: "report", limit: 2, offset })),
    );
    expect(pages.map((page) => page.jobs.length)).toEqual([2, 2, 1]);
    expect(pages.every((page) => page.total === 5)).toBe(true);
    expect(new Set(pages.flatMap((page) => page.jobs.map((job) => job.id)))).toEqual(
      new Set(reportIds),
    );
  });

  it("matches LIKE wildcards literally and ignores a blank search", async () => {
    expect((await getJobs({ search: "%" })).jobs.map((job) => job.name)).toEqual(["50%_off"]);
    expect((await getJobs({ search: "_" })).jobs.map((job) => job.name)).toEqual(["50%_off"]);
    expect((await getJobs({ search: "  " })).total).toBe(8);
  });

  it("combines with the other filters", async () => {
    expect((await getJobs({ search: "report", name: "cleanup" })).total).toBe(0);
    expect((await getJobs({ search: "report", state: "created" })).total).toBe(5);
    expect((await getJobs({ search: "report", state: "failed" })).total).toBe(0);
  });

  it("is the list endpoint's search param", async () => {
    const app = createTestApp();
    const { token } = await signIn(app);
    const res = await api<{ jobs: { id: string }[]; total: number }>(
      app,
      "/api/v1/jobs?search=REPORT&limit=2&offset=4",
      { token },
    );
    expect(res.status).toBe(200);
    expect(res.body.data?.total).toBe(5);
    expect(res.body.data?.jobs).toHaveLength(1);
  });
});
