// Feature: jobs-admin (features/jobs-admin.md). The /jobs operator tools jobs.mjs leaves out:
// Retry a failed job from its detail page (POST /jobs/:id/retry), select rows and bulk re-run
// them (POST /jobs/bulk-rerun), the Schedule dialog → Scheduled jobs panel → edit → cancel
// (POST/DELETE /jobs/schedule…), and Purge by state (DELETE /jobs/state/failed) on a state that
// holds only this drive's jobs, proving every other job survives.
import { journey, expect } from "../scripts/lib.mjs";

// 03:00 on 1 January (then 04:00 after the edit): cannot fire during a drive in November.
const CRON = "0 3 1 1 *";
const CRON_EDITED = "0 4 1 1 *";

await journey("jobs-admin", async ({ page, step, proof, cleanup, api, stamp }) => {
  const schedName = `verify-sched-${stamp}`;
  const short = (id) => id.slice(0, 6);
  const label = (id) => `routine-fire (${short(id)})`;
  const jobRow = (id) => page.getByRole("row", { name: `Job ${label(id)}` });
  const job = (id) => api.get(`/jobs/${id}`);
  const editButton = () => page.getByRole("button", { name: `Edit schedule ${schedName}` });
  const cancelButton = () => page.getByRole("button", { name: `Cancel schedule ${schedName}` });
  const ours = async () =>
    (await api.get("/jobs?limit=500")).jobs.filter(
      (j) => j.data?.verify === stamp || j.name === schedName,
    );
  const responseTo = (method, pathRe) =>
    page.waitForResponse((r) => r.request().method() === method && pathRe.test(r.url()));
  let failedA;
  let failedB;
  let parked;
  let copies = [];
  let othersBeforePurge = [];

  // Runs last: every job this drive made, and the schedule if a step failed before cancelling it.
  cleanup(async () => {
    for (const j of await ours()) {
      const res = await page.request.delete(`/api/v1/jobs/${j.id}`);
      if (!res.ok() && res.status() !== 404) throw new Error(`delete job ${j.id}: ${res.status()}`);
    }
    if ((await api.get("/jobs/schedule")).some((s) => s.name === schedName))
      await api.delete(`/jobs/schedule/${schedName}`);
    expect((await api.get("/jobs/schedule")).some((s) => s.name === schedName)).toBe(false);
    expect(await ours()).toHaveLength(0);
  });

  await step(
    "setup: two failing routine-fire jobs and one parked job of its own type (API)",
    async () => {
      // A routine-fire payload without routineId fails validation at once; retryLimit 0 = no retries.
      const fail = async (n) =>
        (
          await api.post("/jobs", {
            jobName: "routine-fire",
            data: { verify: stamp, n },
            options: { retryLimit: 0 },
          })
        ).jobId;
      failedA = await fail(1);
      failedB = await fail(2);
      // No handler is registered for this name: the job stays Created, and the name becomes a
      // job type the Schedule dialog offers (no collision with any real schedule).
      parked = (await api.post("/jobs", { jobName: schedName, data: { verify: stamp } })).jobId;
      for (const id of [failedA, failedB])
        await expect.poll(async () => (await job(id)).state, { timeout: 30_000 }).toBe("failed");
      expect((await job(parked)).state).toBe("created");
    },
  );

  await step("Failed tab: open a failed job from its row (/jobs/:jobId)", async () => {
    await page.goto("/jobs?state=failed");
    await expect(page.getByRole("heading", { name: "Failed jobs" })).toBeVisible();
    await page.getByRole("link", { name: `View details for job ${label(failedA)}` }).click();
    await expect(page).toHaveURL(new RegExp(`/jobs/${failedA}$`));
    await expect(page.getByRole("heading", { name: "routine-fire", level: 1 })).toBeVisible();
    await expect(page.getByText("Error", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  });
  await proof("failed-detail");

  await step("Retry: the job is queued again, runs again and fails again", async () => {
    const before = await job(failedA);
    const retried = responseTo("POST", new RegExp(`/api/v1/jobs/${failedA}/retry$`));
    await page.getByRole("button", { name: "Retry" }).click();
    expect((await retried).status()).toBe(200);
    await expect(page.getByText("Job has been queued for retry")).toBeVisible();
    // A second run: a newer start time, and the payload still fails.
    await expect
      .poll(
        async () => {
          const now = await job(failedA);
          const at = (j) => new Date(j.startedAt ?? 0).getTime();
          return now.state === "failed" && at(now) > at(before);
        },
        { timeout: 30_000 },
      )
      .toBe(true);
    await page.reload();
    await expect(page.getByText("Failed", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  });
  await proof("retried");

  await step("select both failed rows and Rerun 2 after confirming", async () => {
    await page.goto("/jobs?state=failed");
    await expect(jobRow(failedA)).toBeVisible();
    await page.getByRole("checkbox", { name: `Select job ${label(failedA)}` }).click();
    await page.getByRole("checkbox", { name: `Select job ${label(failedB)}` }).click();
    await expect(
      page.getByRole("checkbox", { name: `Select job ${label(failedA)}` }),
    ).toBeChecked();
    await page.getByRole("button", { name: "Rerun 2" }).click();
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toContainText("Re-run 2 selected jobs?");
    await proof("bulk-rerun-confirm");
    const bulk = responseTo("POST", /\/api\/v1\/jobs\/bulk-rerun$/);
    await confirm.getByRole("button", { name: "Re-run" }).click();
    const results = (await (await bulk).json()).data;
    expect(results.map((r) => [r.jobId, r.success]).sort()).toEqual(
      [
        [failedA, true],
        [failedB, true],
      ].sort(),
    );
    await expect(page.getByText("Successfully triggered re-run for 2 of 2 jobs.")).toBeVisible();
    copies = results.map((r) => r.newJobId);
    // The selection clears once the re-run went through.
    await expect(page.getByRole("button", { name: /^Rerun \d/ })).toHaveCount(0);
  });

  await step("the copies carry the same payloads and fail too; the originals stay", async () => {
    for (const id of copies)
      await expect.poll(async () => (await job(id)).state, { timeout: 30_000 }).toBe("failed");
    const data = await Promise.all(copies.map(async (id) => (await job(id)).data.n));
    expect(data.sort()).toEqual([1, 2]);
    expect((await job(failedA)).state).toBe("failed");
    expect((await job(failedB)).state).toBe("failed");
    await page.reload();
    for (const id of [failedA, failedB, ...copies]) await expect(jobRow(id)).toBeVisible();
  });
  await proof("bulk-rerun-done");

  await step("Schedule: a recurring job of its own type through the dialog", async () => {
    await page.goto("/jobs");
    await page.getByRole("button", { name: "Schedule", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Schedule Recurring Job" });
    await expect(dialog).toBeVisible();
    // Payload first: the job-type menu's focus return can swallow the editor click (jobs.mjs).
    await dialog.locator(".cm-content").click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.insertText(`{"verify": "${stamp}"}`);
    await dialog.getByLabel("Cron expression").fill(CRON);
    await dialog.getByRole("button", { name: "Job type" }).click();
    await page.getByRole("menuitem", { name: schedName }).click();
    await expect(dialog.getByRole("button", { name: "Job type" })).toHaveText(schedName);
    const scheduled = responseTo("POST", /\/api\/v1\/jobs\/schedule$/);
    await dialog.getByRole("button", { name: "Schedule Job" }).click();
    expect((await scheduled).status()).toBe(201);
    await expect(page.getByText("Job has been scheduled")).toBeVisible();
    await expect(dialog).toHaveCount(0);
    const row = (await api.get("/jobs/schedule")).find((s) => s.name === schedName);
    expect(row).toMatchObject({ cron: CRON, data: { verify: stamp } });
  });

  await step("the Scheduled jobs panel lists it, also after a reload", async () => {
    await page.reload();
    // The panel renders a desktop grid and (hidden) phone cards: first() is the desktop row.
    // Its name text also labels the parked job's row, so the panel's own buttons identify it.
    await expect(page.getByRole("heading", { name: "Scheduled jobs" })).toBeVisible();
    await expect(editButton().first()).toBeAttached();
    await expect(page.getByText(CRON, { exact: true }).first()).toBeVisible();
    await expect(page.getByText(`{"verify":"${stamp}"}`).first()).toBeVisible();
  });
  await proof("scheduled-panel");

  await step("Edit schedule: the cron changes, the name is fixed", async () => {
    await page.getByText(CRON, { exact: true }).first().hover(); // the buttons show on hover
    await editButton().first().click();
    const dialog = page.getByRole("dialog", { name: "Edit Scheduled Job" });
    await expect(dialog.getByRole("button", { name: "Job type" })).toBeDisabled();
    await expect(dialog.getByLabel("Cron expression")).toHaveValue(CRON);
    await dialog.getByLabel("Cron expression").fill(CRON_EDITED);
    await dialog.getByRole("button", { name: "Save Changes" }).click();
    await expect(page.getByText("Scheduled job has been updated")).toBeVisible();
    await expect(page.getByText(CRON_EDITED, { exact: true }).first()).toBeVisible();
    const rows = (await api.get("/jobs/schedule")).filter((s) => s.name === schedName);
    expect(rows.map((s) => s.cron)).toEqual([CRON_EDITED]);
  });

  await step("Cancel schedule after confirming: gone from the panel and the API", async () => {
    await page.getByText(CRON_EDITED, { exact: true }).first().hover();
    await cancelButton().first().click();
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toContainText(`Cancel scheduled job "${schedName}"?`);
    const removed = responseTo("DELETE", new RegExp(`/api/v1/jobs/schedule/${schedName}$`));
    await confirm.getByRole("button", { name: "Cancel schedule" }).click();
    expect((await removed).status()).toBe(200);
    await expect(page.getByText("Scheduled job has been cancelled")).toBeVisible();
    await expect(cancelButton()).toHaveCount(0);
    await expect(page.getByText(CRON_EDITED, { exact: true })).toHaveCount(0);
    expect((await api.get("/jobs/schedule")).some((s) => s.name === schedName)).toBe(false);
    // Cancelling the schedule leaves already-queued jobs of that type alone.
    expect((await job(parked)).state).toBe("created");
  });
  await proof("schedule-cancelled");

  await step("guard: every Failed job on this run is one this drive created", async () => {
    const failed = (await api.get("/jobs?state=failed&limit=500")).jobs;
    const strangers = failed.filter((j) => j.data?.verify !== stamp).map((j) => j.id);
    expect(strangers, "Purge Failed would delete jobs this drive did not create").toEqual([]);
    expect(failed.map((j) => j.id).sort()).toEqual([failedA, failedB, ...copies].sort());
    othersBeforePurge = (await api.get("/jobs?limit=500")).jobs
      .filter((j) => j.state !== "failed")
      .map((j) => j.id);
    expect(othersBeforePurge).toContain(parked);
  });

  await step(
    "Purge Failed after confirming: the failed jobs go, every other job stays",
    async () => {
      await page.goto("/jobs?state=failed");
      await expect(jobRow(failedA)).toBeVisible();
      await page.getByRole("button", { name: "Purge Failed" }).click();
      const confirm = page.getByRole("alertdialog");
      await expect(confirm).toContainText("Purge all Failed jobs?");
      await proof("purge-confirm");
      const purged = responseTo("DELETE", /\/api\/v1\/jobs\/state\/failed$/);
      await confirm.getByRole("button", { name: "Purge" }).click();
      expect((await (await purged).json()).data.count).toBe(4);
      await expect(page.getByText("Purged 4 Failed jobs")).toBeVisible();
      await expect(page.getByText("No failed jobs")).toBeVisible();
      expect((await api.get("/jobs?state=failed&limit=500")).jobs).toHaveLength(0);
      for (const id of [failedA, failedB, ...copies])
        expect((await page.request.get(`/api/v1/jobs/${id}`)).status()).toBe(404);
      const left = new Set((await api.get("/jobs?limit=500")).jobs.map((j) => j.id));
      expect(
        othersBeforePurge.filter((id) => !left.has(id)),
        "jobs lost to the purge",
      ).toEqual([]);
      expect((await job(parked)).state).toBe("created");
    },
  );
  await proof("purged");
});
