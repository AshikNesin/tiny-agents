import { describe, expect, it } from "vite-plus/test";
import { createJobSchema, getJobsSchema, scheduleJobSchema } from "@groot/jobs/server/validation";

describe("job validation schemas", () => {
  it("createJobSchema", () => {
    expect(createJobSchema.safeParse({ jobName: "x" }).success).toBe(true);
    expect(
      createJobSchema.safeParse({ jobName: "x", options: { retryLimit: "2" } }).data?.options,
    ).toEqual({ retryLimit: 2 });
    expect(createJobSchema.safeParse({ jobName: "" }).success).toBe(false);
    expect(createJobSchema.safeParse({ jobName: "x", options: { retryLimit: -1 } }).success).toBe(
      false,
    );
  });

  it("scheduleJobSchema", () => {
    expect(scheduleJobSchema.safeParse({ jobName: "x", cron: "* * * * *" }).success).toBe(true);
    expect(scheduleJobSchema.safeParse({ jobName: "x" }).success).toBe(false);
  });

  it("getJobsSchema coerces pagination", () => {
    expect(getJobsSchema.parse({ limit: "10", offset: "5" })).toEqual({ limit: 10, offset: 5 });
    expect(getJobsSchema.safeParse({ limit: "0" }).success).toBe(false);
  });
});
