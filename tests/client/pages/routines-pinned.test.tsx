/**
 * @vitest-environment jsdom
 *
 * The Routines page pinned state by state: the element tree with roles,
 * names, test ids and text, and the whole markup, while loading, after a
 * failed load, empty, and with routines in each state (on, paused, done,
 * struggling, paused by the app) with Upcoming and Recent runs in each run
 * status; a card's actions while one runs; and the editor for a new routine
 * on each schedule tab (with its preview or error) and for an existing
 * routine of each schedule kind. Recorded on the one-file page before it
 * was split (docs/rewrite/PLAN.md row 5.6), so the split must render each
 * the same.
 */
import React from "react";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { MemoryRouter } from "react-router-dom";
import { GrootUIProvider } from "@groot/ui";
import { Routines } from "@/pages/routines/Routines";
import type { Routine, RoutineRun } from "../../../apps/web/src/shared/api/routines";
import { AppQueryProvider } from "../query-provider";
import { markup, outline } from "../dom-outline";

vi.mock("@/lib/bots-api", () => ({
  botsApi: {
    list: vi.fn().mockResolvedValue([
      { id: "b1", name: "Helper Bot" },
      { id: "b2", name: "Other Bot" },
    ]),
  },
}));

const api = vi.hoisted(() => ({
  list: vi.fn(),
  recentRuns: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  runNow: vi.fn(),
  resume: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@/lib/routines-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/routines-api")>();
  return {
    ...original,
    routinesApi: {
      list: (...args: unknown[]) => api.list(...args),
      recentRuns: (...args: unknown[]) => api.recentRuns(...args),
      create: (...args: unknown[]) => api.create(...args),
      update: (...args: unknown[]) => api.update(...args),
      runNow: (...args: unknown[]) => api.runNow(...args),
      pause: vi.fn(),
      resume: (...args: unknown[]) => api.resume(...args),
      remove: (...args: unknown[]) => api.remove(...args),
    },
  };
});

const routine = (overrides: Partial<Routine>): Routine => ({
  id: "r1",
  botId: "b1",
  botName: "Helper Bot",
  name: "morning-digest",
  prompt: "Summarize HN.",
  schedule: { kind: "cron", expr: "0 9 * * 1-5" },
  scheduleDescription: "At 09:00, Monday through Friday",
  enabled: true,
  nextRunAt: "2026-11-09T03:30:00.000Z",
  done: false,
  blockedStreak: 0,
  pausedReason: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  ...overrides,
});

const ROUTINES: Routine[] = [
  routine({}),
  routine({
    id: "r2",
    name: "daily-standup",
    schedule: { kind: "cron", expr: "30 8 * * *" },
    scheduleDescription: "At 08:30",
    nextRunAt: "2026-11-07T03:00:00.000Z",
  }),
  routine({
    id: "r3",
    name: "weekly-review",
    schedule: { kind: "cron", expr: "0 17 * * 5" },
    scheduleDescription: "At 17:00, only on Friday",
    enabled: false,
    nextRunAt: null,
  }),
  routine({
    id: "r4",
    name: "one-off",
    schedule: { kind: "once", at: "2026-11-01T04:30:00.000Z" },
    scheduleDescription: "Once",
    enabled: false,
    done: true,
    nextRunAt: null,
  }),
  routine({
    id: "r5",
    name: "poller",
    schedule: { kind: "interval", minutes: 45 },
    scheduleDescription: "Every 45 minutes",
    nextRunAt: "2026-11-06T07:00:00.000Z",
    blockedStreak: 2,
  }),
  routine({
    id: "r6",
    name: "struggler",
    blockedStreak: 1,
    nextRunAt: "2026-11-06T09:00:00.000Z",
  }),
  routine({
    id: "r7",
    name: "parked",
    enabled: false,
    nextRunAt: null,
    blockedStreak: 3,
    pausedReason: "Paused after 3 blocked runs in a row.",
  }),
];

const run = (overrides: Partial<RoutineRun>): RoutineRun => ({
  id: "run1",
  routineId: "r1",
  routineName: "morning-digest",
  botName: "Helper Bot",
  scheduledFor: "2026-11-05T03:30:00.000Z",
  status: "succeeded",
  trigger: "manual",
  requestId: "routine:r1",
  submittedAt: "2026-11-05T03:30:00.000Z",
  startedAt: "2026-11-05T03:30:00.000Z",
  finishedAt: "2026-11-05T03:31:04.000Z",
  output: "**Echo**: done",
  error: null,
  conversationId: null,
  tokens: null,
  ...overrides,
});

const RUNS: RoutineRun[] = [
  run({}),
  run({ id: "run2", status: "blocked", trigger: "schedule", output: null, error: "Asked twice" }),
  run({
    id: "run3",
    status: "failed",
    routineName: undefined,
    finishedAt: "2026-11-05T03:30:12.000Z",
    output: null,
    error: "Model down",
  }),
  run({ id: "run4", status: "awaiting", startedAt: null, finishedAt: null, output: null }),
  run({ id: "run5", status: "missed", trigger: "schedule", output: null }),
  run({ id: "run6", status: "cancelled", output: null }),
];

function load(routines: Routine[] = ROUTINES, runs: RoutineRun[] = RUNS) {
  api.list.mockResolvedValue(routines);
  api.recentRuns.mockResolvedValue({ runs });
}

async function mount() {
  const result = render(
    <AppQueryProvider>
      <MemoryRouter>
        <GrootUIProvider>
          <Routines />
        </GrootUIProvider>
      </MemoryRouter>
    </AppQueryProvider>,
  );
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  return result;
}

function pin(name?: string) {
  expect(outline(document.body)).toMatchSnapshot(name ? `${name} outline` : "outline");
  expect(markup(document.body)).toMatchSnapshot(name ? `${name} markup` : "markup");
}

const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

const user = userEvent.setup();

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
});

describe("Routines page, pinned", { timeout: 15_000 }, () => {
  it("while loading", async () => {
    api.list.mockReturnValue(new Promise(() => {}));
    api.recentRuns.mockReturnValue(new Promise(() => {}));
    await mount();
    pin();
  });

  it("after a failed load", async () => {
    api.list.mockRejectedValue(new Error("Server down"));
    api.recentRuns.mockResolvedValue({ runs: [] });
    await mount();
    await screen.findByText("Couldn't load routines");
    pin();
  });

  it("with no routines", async () => {
    load([], []);
    await mount();
    await screen.findByText("No routines yet");
    pin();
  });

  it("with one routine", async () => {
    load([ROUTINES[0]!], []);
    await mount();
    await screen.findByText("Schedules");
    pin();
  });

  it("with routines in each state and runs in each status", async () => {
    load();
    await mount();
    await screen.findByText("Recent runs");
    pin();
  });

  it("a card while it runs", async () => {
    load();
    api.runNow.mockReturnValue(new Promise(() => {}));
    await mount();
    await screen.findByText("Recent runs");
    await user.click(screen.getAllByRole("button", { name: "Run now" })[0]!);
    pin();
  });

  it("the editor for a new routine, on each schedule tab", async () => {
    load();
    await mount();
    await screen.findByText("Recent runs");
    await user.click(screen.getByRole("button", { name: "New routine" }));
    await settle();
    const dialog = await screen.findByRole("dialog");
    pin("daily");
    await user.type(within(dialog).getByLabelText("Prompt"), "Check the inbox and summarize");
    pin("with a prompt");
    for (const tab of ["Once", "Weekly", "Interval", "Cron"]) {
      await user.click(within(dialog).getByRole("tab", { name: tab }));
      pin(tab.toLowerCase());
    }
    await user.type(within(dialog).getByLabelText("Cron expression"), "nope");
    pin("bad cron");
    await user.clear(within(dialog).getByLabelText("Cron expression"));
    await user.type(within(dialog).getByLabelText("Cron expression"), "15 6 * * 1-5");
    pin("good cron");
    await user.click(within(dialog).getByRole("tab", { name: "Interval" }));
    await user.clear(within(dialog).getByLabelText("Interval minutes"));
    pin("empty interval");
    await user.type(within(dialog).getByLabelText("Interval minutes"), "2");
    pin("short interval");
  });

  it.each([
    ["a weekday cron", "morning-digest"],
    ["a daily cron", "daily-standup"],
    ["a weekly cron", "weekly-review"],
    ["a done once", "one-off"],
    ["an interval", "poller"],
  ])("the editor for %s", async (_kind, name) => {
    load();
    await mount();
    await screen.findByText("Recent runs");
    const card = screen
      .getAllByText(name)
      .map((el) => el.closest("[data-slot=card]"))
      .find((el) => el?.querySelector("[role=switch]"))!;
    await user.click(within(card as HTMLElement).getByRole("button", { name: "Edit" }));
    await settle();
    await screen.findByRole("dialog");
    pin();
  });
});
