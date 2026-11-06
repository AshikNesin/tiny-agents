// Feature: routine-schedule (features/routine-schedule.md). A routine created in the editor fires
// on its own schedule (no Run now, no job action): a "once" slot 1-2 minutes ahead is queued as a
// routine-fire job, the worker fires it, and the run shows as `schedule` in Recent runs, in the
// API and as the quiet line in the bot's chat. A second routine is edited in the editor (PATCH),
// paused/resumed from its card's switch, and deleted.
import { journey, expect } from "../scripts/lib.mjs";

const IST_MS = 330 * 60_000; // IST is UTC+05:30 all year (no DST)
/** `YYYY-MM-DDTHH:mm` IST wall clock, the editor's datetime-local value. */
const istInput = (ms) => new Date(ms + IST_MS).toISOString().slice(0, 16);

await journey("routine-schedule", async ({ page, step, proof, cleanup, api, stamp }) => {
  const botName = `Sched Bot ${stamp}`;
  const onceName = `verify-once-${stamp}`;
  const prompt = `scheduled check ${stamp}`;
  const editName = `verify-edit-${stamp}`;
  const edited = `verify-edited-${stamp}`;
  const editedPrompt = `edited prompt ${stamp}`;
  let botId;
  let onceId;
  let editId;
  let fireAt; // ms epoch of the once slot
  // A routine card has no landmark: anchor on its pause/resume switch.
  const card = (name) =>
    page
      .getByRole("switch", { name: new RegExp(`^(resume|pause) ${name}$`, "i") })
      .locator("xpath=ancestor::*[.//button[normalize-space()='Run now']][1]");
  const routineJobs = async (id) =>
    (await api.get("/jobs?name=routine-fire&limit=500")).jobs.filter(
      (j) => j.data?.routineId === id,
    );
  const armedJobs = async (id) => (await routineJobs(id)).filter((j) => j.state === "created");
  const routine = (id) => api.get(`/routines/${id}`);

  // Every scheduled fire pushes `routine.succeeded` when Pushover is configured.
  await step("guard: Pushover is not configured on this instance", async () => {
    expect((await api.get("/notifications/status")).state).toBe("not_configured");
  });
  await step("setup: a faux bot to own the routines (API)", async () => {
    // Registered first so it runs last: the routine-fire job rows our routines produced
    // (deleting a routine only cancels its pending job; a fired job stays as completed).
    cleanup(async () => {
      for (const id of [onceId, editId].filter(Boolean)) {
        for (const j of await routineJobs(id)) await api.delete(`/jobs/${j.id}`);
      }
    });
    const models = await api.get("/models");
    botId = (await api.post("/bots", { name: botName, modelId: models.defaultModel })).id;
    cleanup(() => api.delete(`/bots/${botId}`));
  });

  await step("open Routines from the account menu", async () => {
    await page.getByRole("button", { name: "Account and navigation" }).click();
    await page.getByRole("menuitem", { name: "Routines" }).click();
    await expect(page).toHaveURL(/\/routines$/);
    await expect(page.getByRole("heading", { name: "Routines" })).toBeVisible();
  });

  await step("editor: a once routine 1-2 minutes ahead, previewed before saving", async () => {
    await page
      .getByRole("button", { name: /new routine/i })
      .first()
      .click();
    const dialog = page.getByRole("dialog", { name: "New routine" });
    await dialog.getByRole("combobox", { name: "Bot" }).click();
    await page.getByRole("option", { name: botName }).click();
    await dialog.getByLabel("Prompt").fill(prompt);
    await dialog.getByLabel(/^Name/).fill(onceName);
    await dialog.getByRole("tab", { name: "Once" }).click();
    // The input has minute resolution: the next-but-one minute boundary is 60-120 s away,
    // far enough to save before it passes, near enough to wait for.
    fireAt = Math.floor((Date.now() + 120_000) / 60_000) * 60_000;
    await dialog.getByLabel("Run at (IST)").fill(istInput(fireAt));
    const hhmm = istInput(fireAt).slice(11);
    await expect(dialog.getByText(new RegExp(`^Once, .*${hhmm} IST$`))).toBeVisible();
    await expect(dialog.getByRole("listitem")).toHaveCount(1); // a once slot previews one time
  });
  await proof("once-editor");

  await step("Create (enabled) arms one queued routine-fire job for that slot", async () => {
    await page.getByRole("dialog").getByRole("button", { name: "Create" }).click();
    await expect(page.getByText("Routine created")).toBeVisible();
    await expect(page.getByRole("dialog")).not.toBeVisible();
    onceId = (await api.get("/routines")).find((r) => r.name === onceName)?.id;
    expect(onceId, "routine row in GET /routines").toBeTruthy();
    cleanup(async () => {
      const res = await page.request.delete(`/api/v1/routines/${onceId}`);
      if (!res.ok() && res.status() !== 404) throw new Error(`delete routine ${res.status()}`);
    });
    const row = await routine(onceId);
    expect(row.enabled).toBe(true);
    expect(row.schedule).toEqual({ kind: "once", at: `${istInput(fireAt)}:00+05:30` });
    expect(new Date(row.nextRunAt).getTime()).toBe(fireAt);
    const jobs = await armedJobs(onceId);
    expect(jobs, "exactly one armed routine-fire job").toHaveLength(1);
    expect(jobs[0].data).toMatchObject({ trigger: "schedule" });
    expect(new Date(jobs[0].data.scheduledFor).getTime()).toBe(fireAt);
    await expect(card(onceName)).toContainText(`Next run`);
    await expect(card(onceName)).toContainText(`${istInput(fireAt).slice(11)} IST`);
    await expect(card(onceName).getByRole("switch")).toBeChecked();
  });
  await proof("once-armed");

  // While the once slot is pending: edit / pause / resume / delete a second routine.
  await step("setup: a second routine, enabled every hour (API)", async () => {
    const made = await api.post("/routines", {
      botId,
      name: editName,
      prompt: "before the edit",
      schedule: { kind: "interval", minutes: 60 },
      enabled: true,
    });
    editId = made.id;
    cleanup(async () => {
      const res = await page.request.delete(`/api/v1/routines/${editId}`);
      if (!res.ok() && res.status() !== 404) throw new Error(`delete routine ${res.status()}`);
    });
    await page.reload();
    await expect(card(editName)).toContainText(`${botName} · Every hour`);
  });

  await step("Edit: name, prompt and a Daily 07:45 schedule; Save sends a PATCH", async () => {
    await card(editName).getByRole("button", { name: "Edit" }).click();
    const dialog = page.getByRole("dialog", { name: "Edit routine" });
    await expect(dialog.getByLabel("Prompt")).toHaveValue("before the edit");
    await expect(dialog.getByRole("tab", { name: "Interval" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(dialog.getByLabel("Interval minutes")).toHaveValue("60");
    await dialog.getByLabel(/^Name/).fill(edited);
    await dialog.getByLabel("Prompt").fill(editedPrompt);
    await dialog.getByRole("tab", { name: "Daily" }).click();
    await dialog.getByRole("combobox", { name: "Time (IST)" }).click();
    await page.getByRole("option", { name: "07:45", exact: true }).click();
    await expect(dialog.getByText("At 07:45", { exact: true })).toBeVisible();
    await expect(dialog.getByText(/07:45 IST$/)).toHaveCount(3);
    await proof("edit-dialog");
    const patch = page.waitForRequest(
      (r) => r.method() === "PATCH" && r.url().endsWith(`/api/v1/routines/${editId}`),
    );
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    const body = (await patch).postDataJSON();
    expect(body).toMatchObject({
      botId,
      name: edited,
      prompt: editedPrompt,
      schedule: { kind: "cron", expr: "45 7 * * *" },
    });
    await expect(page.getByText("Routine saved")).toBeVisible();
    await expect(dialog).not.toBeVisible();
  });

  await step("reload: the edit persists on the card, in the editor and in the API", async () => {
    await page.reload();
    await expect(card(edited)).toContainText(`${botName} · At 07:45`);
    await expect(card(edited)).toContainText(/Next run .*07:45 IST/);
    await expect(card(editName)).toHaveCount(0);
    const row = await routine(editId);
    expect(row).toMatchObject({
      name: edited,
      prompt: editedPrompt,
      schedule: { kind: "cron", expr: "45 7 * * *" },
      enabled: true,
    });
    expect(new Date(row.nextRunAt).toISOString()).toMatch(/T02:15:00\.000Z$/); // 07:45 IST
    // The schedule edit re-armed the chain: one live job, for the new slot.
    const jobs = await armedJobs(editId);
    expect(jobs).toHaveLength(1);
    expect(new Date(jobs[0].data.scheduledFor).getTime()).toBe(new Date(row.nextRunAt).getTime());
    await card(edited).getByRole("button", { name: "Edit" }).click();
    const dialog = page.getByRole("dialog", { name: "Edit routine" });
    await expect(dialog.getByLabel(/^Name/)).toHaveValue(edited);
    await expect(dialog.getByLabel("Prompt")).toHaveValue(editedPrompt);
    await expect(dialog.getByRole("tab", { name: "Daily" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(dialog.getByRole("combobox", { name: "Time (IST)" })).toContainText("07:45");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).not.toBeVisible();
  });
  await proof("edited");

  await step("card switch pauses it: Paused, no next run, its job cancelled", async () => {
    const patch = page.waitForRequest(
      (r) => r.method() === "PATCH" && r.url().endsWith(`/api/v1/routines/${editId}`),
    );
    await card(edited)
      .getByRole("switch", { name: `Pause ${edited}` })
      .click();
    // The switch sends PATCH { enabled: false } (not POST /pause).
    expect((await patch).postDataJSON()).toEqual({ enabled: false });
    await expect(card(edited).getByRole("switch", { name: `Resume ${edited}` })).not.toBeChecked();
    await expect(card(edited).getByText("Paused", { exact: true })).toBeVisible();
    await expect.poll(async () => (await routine(editId)).enabled).toBe(false);
    expect((await routine(editId)).nextRunAt).toBeNull();
    expect(await armedJobs(editId)).toHaveLength(0);
    await page.reload();
    await expect(card(edited).getByText("Paused", { exact: true })).toBeVisible();
  });
  await proof("paused");

  await step("card switch resumes it: next run back, one job armed again", async () => {
    await card(edited)
      .getByRole("switch", { name: `Resume ${edited}` })
      .click();
    await expect(card(edited).getByRole("switch", { name: `Pause ${edited}` })).toBeChecked();
    await expect(card(edited)).toContainText(/Next run .*07:45 IST/);
    await expect.poll(async () => (await routine(editId)).enabled).toBe(true);
    expect((await routine(editId)).nextRunAt).not.toBeNull();
    expect(await armedJobs(editId)).toHaveLength(1);
  });

  // The page only calls POST /pause and /resume through "Resume" on a routine the app
  // auto-paused; prove the endpoints and that the card reflects them.
  await step("api-only: POST /pause and POST /resume, read back on the card", async () => {
    const paused = await api.post(`/routines/${editId}/pause`);
    expect(paused).toMatchObject({ enabled: false, nextRunAt: null });
    expect(await armedJobs(editId)).toHaveLength(0);
    await page.reload();
    await expect(card(edited).getByText("Paused", { exact: true })).toBeVisible();
    const resumed = await api.post(`/routines/${editId}/resume`);
    expect(resumed.enabled).toBe(true);
    expect(resumed.nextRunAt).not.toBeNull();
    expect(await armedJobs(editId)).toHaveLength(1);
    await page.reload();
    await expect(card(edited).getByRole("switch", { name: `Pause ${edited}` })).toBeChecked();
  });

  await step("Delete asks first, removes the routine and cancels its job", async () => {
    await card(edited).getByRole("button", { name: "Delete" }).click();
    const confirm = page.getByRole("alertdialog", { name: `Delete "${edited}"?` });
    await expect(confirm).toContainText("permanently deleted");
    await confirm.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText("Routine deleted")).toBeVisible();
    await expect(card(edited)).toHaveCount(0);
    const res = await page.request.get(`/api/v1/routines/${editId}`);
    expect(res.status()).toBe(404);
    expect(await armedJobs(editId)).toHaveLength(0);
  });
  await proof("deleted");

  // Wait for the once slot to fire by itself. Budget: up to 120 s until the slot, the
  // queue's 5 s poll, then the faux reply streaming at 6 tokens/s, plus margin.
  await step("the bot's chat receives the scheduled run's quiet line by itself", async () => {
    await page.goto(`/chats/${botId}`);
    const line = page.getByTestId("routine-runs").filter({ hasText: onceName });
    await expect(page.getByPlaceholder(new RegExp(`message ${botName}`, "i"))).toBeVisible();
    // Opened before the slot: the line must arrive over the chat stream, not on load.
    if (Date.now() < fireAt - 5_000) await expect(line).toHaveCount(0);
    const budget = Math.max(0, fireAt - Date.now()) + 120_000;
    await expect(line).toBeVisible({ timeout: budget });
    await expect(line.getByRole("button")).toContainText("done");
  });
  await proof("chat-line-live");

  await step(
    "API: one run, trigger schedule, for the slot, succeeded; nothing manual",
    async () => {
      await expect
        .poll(async () => (await api.get(`/routines/${onceId}/runs`)).runs.map((r) => r.status), {
          timeout: 60_000,
        })
        .toEqual(["succeeded"]);
      const [run] = (await api.get(`/routines/${onceId}/runs`)).runs;
      expect(run.trigger).toBe("schedule");
      expect(new Date(run.scheduledFor).getTime()).toBe(fireAt);
      expect(run.output).toContain(prompt);
      expect(run.output).toMatch(/^Echo: /);
      // The queue fired it: the one routine-fire job is completed, no other job ran.
      const jobs = await routineJobs(onceId);
      expect(jobs.map((j) => j.state)).toEqual(["completed"]);
      // A fired once routine is done: disabled, nothing armed.
      const row = await routine(onceId);
      expect(row).toMatchObject({ enabled: false, done: true, nextRunAt: null });
    },
  );

  await step("the line opens to the run's output, marked scheduled (no `run now`)", async () => {
    await page.reload();
    const line = page.getByTestId("routine-runs").filter({ hasText: onceName });
    await expect(line).toBeVisible({ timeout: 30_000 });
    await line.getByRole("button").click();
    const detail = line.getByTestId("routine-run");
    await expect(detail).toHaveAttribute("data-status", "succeeded");
    await expect(detail).toContainText(`Echo: Routine`);
    await expect(detail).toContainText(prompt);
    await expect(detail).not.toContainText("run now");
    await expect(line.getByRole("link", { name: "Open routines" })).toBeVisible();
    // Quiet: the labelled prompt is not a transcript message.
    await expect(page.getByText(`**Routine "${onceName}"`)).toHaveCount(0);
    await expect(page.getByText(`Echo: **Routine`)).toHaveCount(0);
  });
  await proof("chat-line-open");

  await step("Recent runs lists it as `schedule` + succeeded; the card says Done", async () => {
    await page.goto("/routines");
    const run = page.getByRole("listitem").filter({ hasText: onceName }).filter({
      hasText: "succeeded",
    });
    await expect(run).toBeVisible();
    await expect(run).toContainText("schedule");
    await expect(run).not.toContainText("manual");
    await expect(run).toContainText(prompt);
    await expect(card(onceName)).toContainText("Done · edit to pick a new time");
    await expect(card(onceName).getByRole("switch", { name: `Resume ${onceName}` })).toBeDisabled();
  });
  await proof("recent-runs");
});
