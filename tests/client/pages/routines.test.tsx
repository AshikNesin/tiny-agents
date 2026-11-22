import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, beforeEach, expect, it, vi } from "vite-plus/test";
import { MemoryRouter } from "react-router-dom";
import { Routines } from "@/pages/routines/Routines";
import { GrootUIProvider } from "@groot/ui";
import type { Routine, RoutineRun } from "../../../apps/web/src/shared/api/routines";
import { AppQueryProvider } from "../query-provider";

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
const rotateHookMock = vi.fn();

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
      rotateHook: (...args: unknown[]) => rotateHookMock(...args),
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
  nextRunAt: "2026-10-21T03:30:00.000Z",
  done: false,
  blockedStreak: 0,
  pausedReason: null,
  hasHook: false,
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
    vi.clearAllMocks();
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
    rotateHookMock.mockResolvedValue({ url: "https://app.test/api/v1/routines/hooks/tok123" });
    const user = userEvent.setup();
    mount();

    expect(await screen.findByText("Runs when its webhook URL is called")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Webhook URL" }));
    expect(rotateHookMock).not.toHaveBeenCalled();
    await user.click(await screen.findByRole("button", { name: "Make new URL" }));

    const field = await screen.findByLabelText("Webhook URL");
    expect((field as HTMLInputElement).value).toBe("https://app.test/api/v1/routines/hooks/tok123");
    expect(rotateHookMock).toHaveBeenCalledWith("r9");
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
    await waitFor(() => expect(createMock).toHaveBeenCalled());
    expect(createMock.mock.calls[0]![0]).toMatchObject({ schedule: { kind: "webhook" } });
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
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getAllByText(/\d{2}:\d{2} IST/).length).toBe(3);

    await user.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect(createMock.mock.calls[0][0].schedule).toEqual({ kind: "cron", expr: "30 18 * * *" });
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

  it("shows a started run's result without a reload", async () => {
    const awaiting: RoutineRun = {
      ...run,
      status: "awaiting",
      finishedAt: null,
      output: null,
    };
    listMock.mockResolvedValue([routine]);
    recentRunsMock.mockResolvedValueOnce({ runs: [awaiting] }).mockResolvedValue({ runs: [run] });
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

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect(createMock.mock.calls[0][0]).toMatchObject({
      botId: "b1",
      name: "Summarize what changed in my repos…",
      schedule: { kind: "cron" },
    });
  });
});
