// Feature: jobs (features/jobs.md). A routine save arms a real routine-fire job; the /jobs list,
// state filter, row link, detail page, Cancel/Resume, Add Job → completed, a failed job, Re-run, Delete.
import { journey, expect } from "../scripts/lib.mjs";

await journey("jobs", async ({ page, step, proof, cleanup, api, stamp }) => {
  const botName = `Jobs Bot ${stamp}`;
  const routineName = `verify-jobs-routine-${stamp}`;
  const missingRoutine = `verify-missing-${stamp}`;
  const short = (id) => id.slice(0, 6);
  const jobRow = (id) => page.getByRole("row", { name: `Job routine-fire (${short(id)})` });
  const detailPath = (id) => `/jobs/routine-fire/${id}`; // the route App.tsx mounts
  const jobState = async (id) => (await api.get(`/jobs/${id}`)).state;
  const forget = (id) => async () => {
    const res = await page.request.get(`/api/v1/jobs/${id}`);
    if (res.status() === 200) await api.delete(`/jobs/${id}`);
  };
  // A product bug fails the drive at the end but lets the rest of the recipe run.
  const bugs = [];
  const bugStep = async (name, body) => {
    try {
      await step(name, body);
    } catch {
      bugs.push(name);
      await proof(`bug-${bugs.length}`);
    }
  };
  let routineId;
  let armedId;
  let doneId;
  let failedId;

  // Resume fires a real routine occurrence, which pushes "Routine finished" when Pushover is
  // configured. Refuse to drive against an instance that would reach real phones.
  await step("guard: Pushover is not configured on this instance", async () => {
    expect((await api.get("/notifications/status")).state).toBe("not_configured");
  });
  await step(
    "setup: a faux bot and an enabled 15-minute routine, which arms a job (API)",
    async () => {
      // Runs last: every job this drive's routine or payloads produced (the routine's
      // delete only cancels its pending job).
      cleanup(async () => {
        const { jobs } = await api.get("/jobs?name=routine-fire&limit=500");
        const ours = jobs.filter(
          (j) =>
            j.data?.routineId === routineId ||
            j.data?.routineId === missingRoutine ||
            j.data?.verify === stamp,
        );
        for (const j of ours) await api.delete(`/jobs/${j.id}`);
      });
      const models = await api.get("/models");
      const bot = await api.post("/bots", { name: botName, modelId: models.defaultModel });
      cleanup(() => api.delete(`/bots/${bot.id}`));
      const routine = await api.post("/routines", {
        botId: bot.id,
        name: routineName,
        prompt: "say the thing",
        schedule: { kind: "interval", minutes: 15 },
        enabled: true,
      });
      routineId = routine.id;
      cleanup(() => api.delete(`/routines/${routine.id}`));
      const { jobs } = await api.get("/jobs?name=routine-fire&limit=500");
      armedId = jobs.find((j) => j.data?.routineId === routine.id)?.id;
      expect(armedId, "saving an enabled routine queued a routine-fire job").toBeTruthy();
      cleanup(forget(armedId));
      expect(await jobState(armedId)).toBe("created");
    },
  );
  await step("/jobs lists the armed job as Created", async () => {
    await page.goto("/jobs");
    await expect(page.getByRole("heading", { name: "Jobs", level: 1 })).toBeVisible();
    await expect(jobRow(armedId)).toBeVisible();
    await expect(jobRow(armedId).getByRole("cell").nth(1)).toHaveText("Created");
  });
  await proof("list");
  await step("the Created stat tile filters the list", async () => {
    await page.getByRole("button", { name: /^Created\b/ }).click();
    await expect(page).toHaveURL(/state=created/);
    await expect(page.getByRole("heading", { name: "Created jobs" })).toBeVisible();
    await expect(jobRow(armedId)).toBeVisible();
    await expect(page.getByRole("button", { name: /purge created/i })).toBeVisible();
  });
  await proof("filtered-created");
  await bugStep("clicking a job row opens its detail page", async () => {
    await page
      .getByRole("link", { name: `View details for job routine-fire (${short(armedId)})` })
      .click();
    await expect(page.getByRole("heading", { name: "routine-fire", level: 1 })).toBeVisible();
    await expect(page.getByText(armedId)).toBeVisible();
  });
  await step(
    "detail page (mounted route): state, overview, data, logs, allowed actions",
    async () => {
      await page.goto(detailPath(armedId));
      await expect(page.getByRole("heading", { name: "routine-fire", level: 1 })).toBeVisible();
      await expect(page.getByText(armedId)).toBeVisible();
      await expect(page.getByText("Created", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("Overview")).toBeVisible();
      await expect(page.getByText("Retries")).toBeVisible();
      await expect(page.locator("main")).toContainText(armedId);
      await expect(page.getByText("No logs available")).toBeVisible();
      await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Delete" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0);
    },
  );
  await proof("detail-created");
  await step("Cancel moves it to Cancelled and offers Retry/Resume", async () => {
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByText("Job has been cancelled")).toBeVisible();
    await expect(page.getByRole("button", { name: "Resume" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel" })).toHaveCount(0);
    expect(await jobState(armedId)).toBe("cancelled");
  });
  await proof("detail-cancelled");
  await step("Resume re-queues it to run now; the page polls it to Completed", async () => {
    await page.getByRole("button", { name: "Resume" }).click();
    await expect(page.getByText("Job has been resumed")).toBeVisible();
    // Resume (like Retry) sets runAt to now, so the occurrence fires on the next
    // queue tick. Wait on the job's state: the text "Completed" also labels an
    // Overview field, so it matches before the job has run.
    await expect.poll(() => jobState(armedId), { timeout: 30_000 }).toBe("completed");
    await expect(page.getByRole("button", { name: "Re-run" })).toBeVisible({ timeout: 15_000 });
  });
  await proof("detail-resumed-completed");
  await step("Add Job: a routine-fire for a missing routine runs and completes", async () => {
    await page.goto("/jobs");
    await page.getByRole("button", { name: "Add Job" }).click();
    const dialog = page.getByRole("dialog", { name: "Add New Job" });
    // Payload first: the job-type menu's closing focus juggling can swallow the editor click.
    await dialog.locator(".cm-content").click();
    await page.keyboard.press("ControlOrMeta+a");
    // insertText, not type(): CodeMirror auto-closes quotes while typing.
    await page.keyboard.insertText(
      `{"routineId": "${missingRoutine}", "scheduledFor": "2026-01-01T00:00:00.000Z"}`,
    );
    await expect(dialog.locator(".cm-content")).toContainText(missingRoutine);
    await dialog.getByRole("button", { name: "Job type" }).click();
    await page.getByRole("menuitem", { name: "routine-fire" }).click();
    await expect(dialog.getByRole("button", { name: "Job type" })).toHaveText("routine-fire");
    await expect(dialog.locator(".cm-content")).toContainText(missingRoutine);
    await dialog.getByRole("button", { name: "Add Job" }).click();
    await expect(page.getByText("Job has been added to the queue.")).toBeVisible();
    const { jobs } = await api.get("/jobs?name=routine-fire&limit=500");
    doneId = jobs.find((j) => j.data?.routineId === missingRoutine)?.id;
    expect(doneId, "the dialog queued the job").toBeTruthy();
    cleanup(forget(doneId));
    await expect.poll(() => jobState(doneId), { timeout: 30_000 }).toBe("completed");
  });
  await bugStep("the toast's View job link opens the new job", async () => {
    await page.getByRole("link", { name: `View job (${short(doneId)})` }).click();
    await expect(page.getByRole("heading", { name: "routine-fire", level: 1 })).toBeVisible();
    await expect(page.getByText(doneId)).toBeVisible();
  });
  await step("completed job detail: Completed, Re-run + Delete only", async () => {
    await page.goto(detailPath(doneId));
    await expect(page.getByText(doneId)).toBeVisible();
    await expect(page.getByText("Completed", { exact: true }).first()).toBeVisible();
    await expect(page.locator("main")).toContainText(missingRoutine);
    await expect(page.getByRole("button", { name: "Re-run" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel" })).toHaveCount(0);
  });
  await proof("detail-completed");
  await step("setup: a routine-fire job with a bad payload and no retries (API)", async () => {
    const res = await api.post("/jobs", {
      jobName: "routine-fire",
      data: { verify: stamp },
      options: { retryLimit: 0 },
    });
    failedId = res.jobId;
    cleanup(forget(failedId));
    await expect.poll(() => jobState(failedId), { timeout: 30_000 }).toBe("failed");
  });
  await step("failed job detail shows the Error card and Retry/Re-run", async () => {
    await page.goto(detailPath(failedId));
    await expect(page.getByText("Failed", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Error", { exact: true })).toBeVisible();
    await expect(page.locator("main")).toContainText(/routineId/);
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Re-run" })).toBeVisible();
  });
  await proof("detail-failed");
  await step("Re-run queues a fresh copy; the original stays failed", async () => {
    await page.getByRole("button", { name: "Re-run" }).click();
    await expect(page.getByText("Job re-run created.")).toBeVisible();
    const { jobs } = await api.get("/jobs?name=routine-fire&limit=500");
    const copy = jobs.find((j) => j.id !== failedId && j.data?.verify === stamp);
    expect(copy, "a new job with the same data").toBeTruthy();
    cleanup(forget(copy.id));
    expect(await jobState(failedId)).toBe("failed");
  });
  await step("the Failed tab lists it; Delete from the row menu after confirming", async () => {
    await page.goto("/jobs?state=failed");
    await expect(page.getByRole("heading", { name: "Failed jobs" })).toBeVisible();
    await expect(jobRow(failedId)).toBeVisible();
    await page
      .getByRole("button", { name: `Actions for job routine-fire (${short(failedId)})` })
      .click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toContainText(`Delete job routine-fire (${short(failedId)})?`);
    await confirm.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText("Job has been deleted")).toBeVisible();
    await expect(jobRow(failedId)).toHaveCount(0);
    expect((await page.request.get(`/api/v1/jobs/${failedId}`)).status()).toBe(404);
  });
  await step("Delete from the detail page returns to /jobs", async () => {
    await page.goto(detailPath(doneId));
    await page.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
    await expect(page).toHaveURL(/\/jobs$/);
    expect((await page.request.get(`/api/v1/jobs/${doneId}`)).status()).toBe(404);
  });
  await step("an unknown job id shows Job Not Found", async () => {
    await page.goto("/jobs/routine-fire/00000000-0000-4000-8000-000000000000");
    await expect(page.getByText("Job Not Found", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Back to Jobs" })).toBeVisible();
  });
  await proof("not-found");
  if (bugs.length) throw new Error(`product bug(s): ${bugs.join("; ")}`);
});
