import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, beforeEach, expect, it } from "vite-plus/test";
import { MemoryRouter } from "react-router-dom";
import { Routines } from "@/pages/routines/Routines";
import { GrootUIProvider } from "@groot/ui";
import type { BotListEntry } from "../../../apps/web/src/shared/api/bots";
import type { Deleted } from "../../../apps/web/src/shared/api/common";
import type {
  Routine,
  RoutineHook,
  RoutineRun,
  RoutineRuns,
  RoutineRunStarted,
  RoutineWithPreview,
} from "../../../apps/web/src/shared/api/routines";
import { FIXED_NOW } from "../../test-clock";
import { fakeApi } from "../fakes/api";
import { AppQueryProvider } from "../query-provider";

let api: ReturnType<typeof fakeApi>;

const helperBot: BotListEntry = {
  id: "b1",
  conversationId: "c1",
  name: "Helper Bot",
  description: "",
  modelId: null,
  lastMessagePreview: null,
  lastActivityAt: FIXED_NOW,
  lastReadAt: null,
  unread: false,
  replying: false,
  approvals: 0,
  questions: 0,
  pinnedAt: null,
  projectId: null,
};

const routine: Routine = {
  id: "r1",
  botId: "b1",
  botName: "Helper Bot",
  name: "morning-digest",
  prompt: "Summarize HN.",
  schedule: { kind: "cron", expr: "0 9 * * 1-5" },
  scheduleDescription: "At 09:00, Monday through Friday",
  enabled: true,
  nextRunAt: "2026-10-21T03:30:00.000Z",
  done: false,
  blockedStreak: 0,
  pausedReason: null,
  hasHook: false,
  progress: null,
  messageRate: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
};

const run: RoutineRun = {
  id: "run1",
  routineId: "r1",
  routineName: "morning-digest",
  botName: "Helper Bot",
  scheduledFor: "2026-10-21T03:30:00.000Z",
  status: "succeeded",
  trigger: "manual",
  requestId: "routine:r1:2026-10-21T03:30:00.000Z",
  submittedAt: "2026-10-21T03:30:00.000Z",
  startedAt: "2026-10-21T03:30:00.000Z",
  finishedAt: "2026-10-21T03:31:04.000Z",
  output: "Echo: done",
  error: null,
  conversationId: null,
  tokens: null,
  messages: null,
};

function loadPage(routines: Routine[] = [routine], runs: RoutineRun[] = [run]) {
  api.get("/routines", () => routines);
  api.get("/routines/runs/recent", (): RoutineRuns => ({ runs }));
  api.post("/routines", (): RoutineWithPreview => ({ ...routine, nextFireTimes: [] }));
  api.patch("/routines/:id", (): RoutineWithPreview => ({ ...routine, nextFireTimes: [] }));
  api.post("/routines/:id/run", (): RoutineRunStarted => ({ runId: "run2" }));
  api.delete("/routines/:id", (): Deleted => ({ deleted: true }));
}

const created = () => api.sent("POST", "/routines");

function mount() {
  return render(
    <React.StrictMode>
      <AppQueryProvider>
        <MemoryRouter>
          <GrootUIProvider>
            <Routines />
          </GrootUIProvider>
        </MemoryRouter>
      </AppQueryProvider>
    </React.StrictMode>,
  );
}

function pickBot(user: ReturnType<typeof userEvent.setup>) {
  return user
    .click(screen.getByRole("combobox", { name: "Bot" }))
    .then(() => screen.findByRole("option", { name: "Helper Bot" }))
    .then((option) => user.click(option));
}

async function fillBasics(user: ReturnType<typeof userEvent.setup>) {
  await pickBot(user);
  await user.type(screen.getByLabelText(/^Name/), "e2e-routine");
  await user.type(screen.getByLabelText("Prompt"), "say the thing");
}

describe("Routines page", { timeout: 15_000 }, () => {
  beforeEach(() => {
    api = fakeApi();
    api.get("/bots", () => [helperBot]);
  });

  it("renders upcoming runs, schedule cards, and recent executions in IST", async () => {
    loadPage([routine, { ...routine, id: "r2", name: "evening-digest" }]);
    mount();

    expect(await screen.findAllByText("Wed, 21 Oct 2026, 09:00 IST")).not.toHaveLength(0);
    expect(screen.getAllByText("morning-digest").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Helper Bot · At 09:00, Monday through Friday").length).toBe(4);
    expect(screen.getByText(/took 1m 4s/)).toBeTruthy();
    expect(screen.getByText("succeeded")).toBeTruthy();
    expect(screen.getByText("manual")).toBeTruthy();
  });

  it("a webhook routine shows its new URL once, after confirming a replacement", async () => {
    const webhook: Routine = {
      ...routine,
      id: "r9",
      name: "inbox",
      schedule: { kind: "webhook" },
      scheduleDescription: "When its webhook URL is called",
      nextRunAt: null,
      hasHook: true,
    };
    loadPage([webhook], []);
    api.post("/routines/:id/hook", (): RoutineHook => ({
      url: "https://app.test/api/v1/routines/hooks/tok123",
    }));
    const user = userEvent.setup();
    mount();

    expect(await screen.findByText("Runs when its webhook URL is called")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Webhook URL" }));
    expect(api.sent("POST", "/routines/r9/hook")).toEqual([]);
    await user.click(await screen.findByRole("button", { name: "Make new URL" }));

    const field = await screen.findByLabelText("Webhook URL");
    expect((field as HTMLInputElement).value).toBe("https://app.test/api/v1/routines/hooks/tok123");
    expect(api.sent("POST", "/routines/r9/hook")).toHaveLength(1);
  });

  it("creates a webhook routine from the Webhook schedule tab", async () => {
    loadPage([], []);
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("button", { name: /New routine/ }));
    await fillBasics(user);
    await user.click(screen.getByRole("tab", { name: "Webhook" }));
    expect(screen.getByText("When its webhook URL is called")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(created()).toHaveLength(1));
    expect(created()[0]!.body).toMatchObject({ schedule: { kind: "webhook" } });
  });

  it("editing shows the routine's progress note, and clearing it saves null", async () => {
    loadPage([{ ...routine, progress: "Done: links 1-5. Next: 6." }], []);
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("button", { name: /Edit/ }));
    const note = await screen.findByLabelText("Progress note");
    expect((note as HTMLTextAreaElement).value).toBe("Done: links 1-5. Next: 6.");
    await user.clear(note);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.sent("PATCH", "/routines/r1")).toHaveLength(1));
    expect(api.sent("PATCH", "/routines/r1")[0]!.body).toMatchObject({ progress: null });
  });

  it("says how often a routine messaged you, and flags one that messages every run", async () => {
    loadPage(
      [
        { ...routine, messageRate: { runs: 10, messaged: 3 } },
        { ...routine, id: "r2", name: "loud", messageRate: { runs: 6, messaged: 6 } },
      ],
      [],
    );
    mount();
    expect(await screen.findByText("Messaged you in 3 of the last 10 runs")).toBeTruthy();
    expect(
      screen.getByText(
        "Messaged you in 6 of the last 6 runs. It messages you every run: tell it in the prompt to stay quiet when nothing is new.",
      ),
    ).toBeTruthy();
  });

  it("shows what a run spent in tokens beside how long it took", async () => {
    loadPage([routine], [{ ...run, tokens: 42_300 }]);
    mount();
    expect(await screen.findByText(/took 1m 4s · 42k tokens/)).toBeTruthy();
  });

  it("creates a routine with the compiled interval schedule", async () => {
    loadPage();
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    mount();
    await user.click(await screen.findByRole("button", { name: /new routine/i }));

    await fillBasics(user);
    await user.click(screen.getByRole("tab", { name: "Interval" }));
    const minutes = await screen.findByLabelText(/interval minutes/i);
    await user.clear(minutes);
    await user.type(minutes, "15");

    expect(await screen.findByText("Every 15 minutes")).toBeTruthy();
    expect(screen.getAllByText(/IST$/).length).toBeGreaterThanOrEqual(3);

    await user.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(created()).toHaveLength(1));
    expect(created()[0]!.body).toEqual(
      expect.objectContaining({
        botId: "b1",
        name: "e2e-routine",
        prompt: "say the thing",
        schedule: { kind: "interval", minutes: 15 },
      }),
    );
  });

  it("compiles the daily preset to a 5-field cron and previews the next runs", async () => {
    loadPage();
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    mount();
    await user.click(await screen.findByRole("button", { name: /new routine/i }));

    await user.click(screen.getByRole("tab", { name: "Daily" }));
    await fillBasics(user);
    await user.click(screen.getByRole("combobox", { name: "Time (IST)" }));
    await user.click(await screen.findByRole("option", { name: "18:30" }));

    expect(await screen.findByText("At 18:30")).toBeTruthy();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getAllByText(/\d{2}:\d{2} IST/).length).toBe(3);

    await user.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(created()).toHaveLength(1));
    expect(created()[0]!.body).toMatchObject({ schedule: { kind: "cron", expr: "30 18 * * *" } });
  });

  it("sends a once schedule with the +05:30 IST offset", async () => {
    const year = new Date().getUTCFullYear() + 1;
    loadPage();
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    mount();
    await user.click(await screen.findByRole("button", { name: /new routine/i }));

    await user.click(await screen.findByRole("tab", { name: "Once" }));
    const at = screen.getByLabelText(/run at \(ist\)/i);
    await user.clear(at);
    await user.type(at, `${year}-11-01T09:00`);

    expect((await screen.findAllByText(`01 Nov ${year}, 09:00 IST`, { exact: false })).length).toBe(
      2,
    );
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getAllByText(`01 Nov ${year}, 09:00 IST`, { exact: false }).length).toBe(
      2,
    );
    await fillBasics(user);
    await user.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(created()).toHaveLength(1));
    expect(created()[0]!.body).toMatchObject({
      schedule: { kind: "once", at: `${year}-11-01T09:00:00+05:30` },
    });
  });

  it("toggles enabled off and back on through update", async () => {
    loadPage();
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    mount();

    const updates = () => api.sent("PATCH", "/routines/r1").map((request) => request.body);
    let saved: Routine = routine;
    api.get("/routines", () => [saved]);
    api.patch("/routines/:id", (): RoutineWithPreview => {
      saved = saved.enabled ? { ...routine, enabled: false, nextRunAt: null } : routine;
      return { ...saved, nextFireTimes: [] };
    });

    const toggle = await screen.findByRole("switch", { name: /pause morning-digest/i });
    await user.click(toggle);
    const resumeToggle = await screen.findByRole("switch", {
      name: /resume morning-digest/i,
    });
    await user.click(resumeToggle);

    await waitFor(() => expect(updates()).toEqual([{ enabled: false }, { enabled: true }]));
  });

  it("runs now and records the action", async () => {
    loadPage();
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    mount();

    await user.click(await screen.findByRole("button", { name: /run now/i }));
    await waitFor(() => expect(api.sent("POST", "/routines/r1/run")).toHaveLength(1));
  });

  it("shows a started run's result without a reload", async () => {
    const awaiting: RoutineRun = {
      ...run,
      status: "awaiting",
      finishedAt: null,
      output: null,
    };
    api.get("/routines", () => [routine]);
    api.get("/routines/runs/recent", (): RoutineRuns => ({
      runs: api.sent("GET", "/routines/runs/recent").length === 1 ? [awaiting] : [run],
    }));
    mount();

    expect(await screen.findByText("awaiting")).toBeTruthy();
    expect(await screen.findByText("succeeded", undefined, { timeout: 6_000 })).toBeTruthy();
    expect(screen.queryByText("awaiting")).toBeNull();
  });

  it("skips the Upcoming list when one routine's card already shows its next run", async () => {
    loadPage();
    mount();

    expect(await screen.findAllByText("morning-digest")).not.toHaveLength(0);
    expect(screen.queryByText("Upcoming")).toBeNull();
    expect(screen.getAllByText("Helper Bot · At 09:00, Monday through Friday")).toHaveLength(1);
  });

  it("starts a new routine daily on the only bot and names it from the prompt", async () => {
    loadPage();
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    mount();
    await user.click(await screen.findByRole("button", { name: /new routine/i }));

    expect(screen.getByRole("tab", { name: "Daily" }).getAttribute("aria-selected")).toBe("true");
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Bot" }).textContent).toContain("Helper Bot"),
    );
    await user.type(
      screen.getByLabelText("Prompt"),
      "Summarize what changed in my repos overnight and flag anything urgent",
    );
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(created()).toHaveLength(1));
    expect(created()[0]!.body).toMatchObject({
      botId: "b1",
      name: "Summarize what changed in my repos…",
      schedule: { kind: "cron" },
    });
  });
});
