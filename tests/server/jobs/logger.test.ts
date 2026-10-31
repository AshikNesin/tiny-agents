import { describe, expect, it } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { db } from "@groot/core/database";
import { createJobLogger, flushJobLogs } from "@groot/jobs/server/logger";
import { jobLogs } from "@groot/jobs/server/schema";

async function rowsFor(jobId: string) {
  await flushJobLogs();
  return db.select().from(jobLogs).where(eq(jobLogs.jobId, jobId)).orderBy(jobLogs.id);
}

describe("createJobLogger", () => {
  it("persists info and above to job_logs through the record sink", async () => {
    const log = createJobLogger({ jobId: "log-test-1", jobName: "send-email" });
    log.debug("not persisted");
    log.info({ step: "queued" }, "started");
    log.child({ attempt: 2 }).error("retry failed");

    const rows = await rowsFor("log-test-1");
    expect(rows.map((row) => row.message)).toEqual(["started", "retry failed"]);
    expect(rows[0]).toMatchObject({
      jobName: "send-email",
      level: "info",
      data: { step: "queued" },
    });
    expect(rows[1]).toMatchObject({ level: "error", data: { attempt: 2 } });
  });

  it("awaits in-flight writes on flushJobLogs", async () => {
    createJobLogger({ jobId: "log-test-2", jobName: "cleanup" }).info("done");
    await flushJobLogs();
    const rows = await rowsFor("log-test-2");
    expect(rows).toHaveLength(1);
  });
});
