/**
 * Routines page behavior (issue #18 phase B): renders server state in IST,
 * the editor posts the compiled schedule (once carries the IST offset, cron
 * presets compile to 5-field cron), and card actions hit the right routes.
 */
import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, beforeEach, expect, it, vi } from "vite-plus/test";
import { MemoryRouter } from "react-router-dom";
import { Routines } from "@/pages/routines/Routines";
import { GrootUIProvider } from "@groot/ui";
import type { Routine, RoutineRun } from "@/lib/routines-api";

vi.mock("@/lib/bots-api", () => ({
  botsApi: {
    list: vi.fn().mockResolvedValue([{ id: "b1", name: "Helper Bot" }]),
  },
}));

const listMock = vi.fn();
const recentRunsMock = vi.fn();
const createMock = vi.fn();
const updateMock = vi.fn();
const runNowMock = vi.fn();
const removeMock = vi.fn();

vi.mock("@/lib/routines-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/routines-api")>();
  return {
    ...original,
    routinesApi: {
      list: (...args: unknown[]) => listMock(...args),
      recentRuns: (...args: unknown[]) => recentRunsMock(...args),
      create: (...args: unknown[]) => createMock(...args),
      update: (...args: unknown[]) => updateMock(...args),
      runNow: (...args: unknown[]) => runNowMock(...args),
      pause: vi.fn(),
      resume: vi.fn(),
      remove: (...args: unknown[]) => removeMock(...args),
    },
  };
});

const routine: Routine = {
  id: "r1",
  botId: "b1",
  botName: "Helper Bot",
  name: "morning-digest",
  prompt: "Summarize HN.",
  schedule: { kind: "cron", expr: "0 9 * * 1-5" },
  scheduleDescription: "At 09:00, Monday through Friday",
  enabled: true,
  // 2026-10-21T03:30:00Z = 09:00 IST Wed; crosses the UTC day boundary.
  nextRunAt: "2026-10-21T03:30:00.000Z",
  blockedStreak: 0,
  pausedReason: null,
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
  submittedAt: "2026-10-21T03:30:00.000Z",
  startedAt: "2026-10-21T03:30:00.000Z",
  finishedAt: "2026-10-21T03:31:04.000Z",
  output: "Echo: done",
  error: null,
};

function loadPage(routines: Routine[] = [routine], runs: RoutineRun[] = [run]) {
  listMock.mockResolvedValue(routines);
  recentRunsMock.mockResolvedValue({ runs });
  createMock.mockResolvedValue({ ...routine, nextFireTimes: [] });
  updateMock.mockResolvedValue({ ...routine, nextFireTimes: [] });
  runNowMock.mockResolvedValue({ runId: "run2" });
  removeMock.mockResolvedValue({ deleted: true });
}

function mount() {
  return render(
    <React.StrictMode>
      <MemoryRouter>
        <GrootUIProvider>
          <Routines />
        </GrootUIProvider>
      </MemoryRouter>
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

// These tests type whole forms through user-event, which takes 1-2 s each
// locally and several times that on a busy CI runner. A 15 s ceiling keeps
// the default 5 s from failing them on slow runs while still catching a hang.
describe("Routines page", { timeout: 15_000 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders upcoming runs, schedule cards, and recent executions in IST", async () => {
    loadPage([routine, { ...routine, id: "r2", name: "evening-digest" }]);
    mount();

    // Upcoming + card next-run + run row all render the same IST instant.
    expect(await screen.findAllByText("Wed, 21 Oct 2026, 09:00 IST")).not.toHaveLength(0);
    expect(screen.getAllByText("morning-digest").length).toBeGreaterThan(0);
    // Two cards plus their two Upcoming rows.
    expect(screen.getAllByText("Helper Bot · At 09:00, Monday through Friday").length).toBe(4);
    // Card + run row both show the routine's state.
    expect(screen.getByText(/took 1m 4s/)).toBeTruthy();
    expect(screen.getByText("succeeded")).toBeTruthy();
    expect(screen.getByText("manual")).toBeTruthy();
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

    // Live preview before saving (acceptance criterion).
    expect(await screen.findByText("Every 15 minutes")).toBeTruthy();
    expect(screen.getAllByText(/IST$/).length).toBeGreaterThanOrEqual(3);

    await user.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect(createMock).toHaveBeenCalledWith(
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
    // Three preview times render before saving (sentence + 3 times).
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getAllByText(/\d{2}:\d{2} IST/).length).toBe(3);

    await user.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect(createMock.mock.calls[0][0].schedule).toEqual({ kind: "cron", expr: "30 18 * * *" });
  });

  it("sends a once schedule with the +05:30 IST offset", async () => {
    // A one-time routine must be in the future, so date it next year rather
    // than on a fixed day that eventually passes.
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
    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect(createMock.mock.calls[0][0].schedule).toEqual({
      kind: "once",
      at: `${year}-11-01T09:00:00+05:30`,
    });
  });

  it("toggles enabled off and back on through update", async () => {
    loadPage();
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    mount();

    // The same refresh `act` performs returns the paused routine.
    listMock.mockImplementation(async () =>
      updateMock.mock.calls.at(-1)?.[1]?.enabled === false
        ? [{ ...routine, enabled: false, nextRunAt: null }]
        : [routine],
    );

    const toggle = await screen.findByRole("switch", { name: /pause morning-digest/i });
    await user.click(toggle);
    const resumeToggle = await screen.findByRole("switch", {
      name: /resume morning-digest/i,
    });
    await user.click(resumeToggle);

    await waitFor(() => expect(updateMock).toHaveBeenNthCalledWith(2, "r1", { enabled: true }));
  });

  it("runs now and records the action", async () => {
    loadPage();
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    mount();

    await user.click(await screen.findByRole("button", { name: /run now/i }));
    await waitFor(() => expect(runNowMock).toHaveBeenCalledWith("r1"));
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

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect(createMock.mock.calls[0][0]).toMatchObject({
      botId: "b1",
      name: "Summarize what changed in my repos…",
      schedule: { kind: "cron" },
    });
  });
});
