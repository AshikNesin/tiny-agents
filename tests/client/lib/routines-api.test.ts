import { beforeEach, describe, expect, it } from "vite-plus/test";
import { routinesApi } from "@/lib/routines-api";
import type { Deleted } from "../../../apps/web/src/shared/api/common";
import type {
  Routine,
  RoutineRun,
  RoutineRuns,
  RoutineRunStarted,
  RoutineWithPreview,
} from "../../../apps/web/src/shared/api/routines";
import { FIXED_NOW } from "../../test-clock";
import { fakeApi } from "../fakes/api";

const intervalSchedule = { kind: "interval", minutes: 15 } as const;

function routine(id: string, overrides: Partial<Routine> = {}): Routine {
  return {
    id,
    botId: "b1",
    botName: "Ada",
    name: "digest",
    prompt: "Summarize HN.",
    schedule: intervalSchedule,
    scheduleDescription: "Every 15 minutes",
    enabled: true,
    nextRunAt: FIXED_NOW,
    done: false,
    blockedStreak: 0,
    pausedReason: null,
    hasHook: false,
    progress: null,
    messageRate: null,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  };
}

function run(id: string, routineId: string): RoutineRun {
  return {
    id,
    routineId,
    scheduledFor: FIXED_NOW,
    status: "succeeded",
    trigger: "schedule",
    requestId: `req-${id}`,
    submittedAt: FIXED_NOW,
    startedAt: FIXED_NOW,
    finishedAt: FIXED_NOW,
    output: "done",
    error: null,
    conversationId: "7",
    tokens: 12,
    messages: 1,
  };
}

let api: ReturnType<typeof fakeApi>;

beforeEach(() => {
  api = fakeApi();
});

describe("routinesApi", () => {
  it("lists routines at the collection root", async () => {
    api.get("/routines", (): Routine[] => [routine("r1")]);
    await expect(routinesApi.list()).resolves.toEqual([routine("r1")]);
    expect(api.sent("GET", "/routines")).toHaveLength(1);
  });

  it("creates with the schedule union in the body", async () => {
    const created: RoutineWithPreview = { ...routine("r1"), nextFireTimes: [FIXED_NOW] };
    api.post("/routines", () => created);
    await expect(
      routinesApi.create({
        botId: "b1",
        name: "digest",
        prompt: "Summarize HN.",
        schedule: intervalSchedule,
      }),
    ).resolves.toEqual(created);
    expect(api.sent("POST", "/routines")[0]!.body).toEqual({
      botId: "b1",
      name: "digest",
      prompt: "Summarize HN.",
      schedule: intervalSchedule,
    });
  });

  it("patches updates and sends enabled toggles as the only field", async () => {
    api.patch("/routines/:id", ({ params }): RoutineWithPreview => ({
      ...routine(params.id!),
      nextFireTimes: [],
    }));
    await expect(routinesApi.update("r1", { name: "renamed" })).resolves.toMatchObject({
      id: "r1",
    });
    expect(api.sent("PATCH", "/routines/r1")[0]!.body).toEqual({ name: "renamed" });

    await routinesApi.update("r2", { enabled: false });
    expect(api.sent("PATCH", "/routines/r2")[0]!.body).toEqual({ enabled: false });
  });

  it("posts lifecycle actions to their sub-routes", async () => {
    api.post("/routines/:id/pause", ({ params }) => routine(params.id!, { enabled: false }));
    api.post("/routines/:id/resume", ({ params }) => routine(params.id!));
    api.post("/routines/:id/run", (): RoutineRunStarted => ({ runId: "run-1" }));

    await expect(routinesApi.pause("r1")).resolves.toMatchObject({ id: "r1", enabled: false });
    expect(api.sent("POST", "/routines/r1/pause")).toMatchObject([{ body: undefined }]);

    await expect(routinesApi.resume("r1")).resolves.toMatchObject({ id: "r1", enabled: true });
    expect(api.sent("POST", "/routines/r1/resume")).toMatchObject([{ body: undefined }]);

    await expect(routinesApi.runNow("r1")).resolves.toEqual({ runId: "run-1" });
    expect(api.sent("POST", "/routines/r1/run")).toMatchObject([{ body: undefined }]);
  });

  it("requests recent runs with a limit and per-routine runs by id", async () => {
    api.get("/routines/runs/recent", (): RoutineRuns => ({ runs: [run("run-1", "r9")] }));
    api.get("/routines/:id/runs", ({ params }): RoutineRuns => ({
      runs: [run("run-2", params.id!)],
    }));

    await expect(routinesApi.recentRuns(5)).resolves.toEqual({ runs: [run("run-1", "r9")] });
    expect(api.sent("GET", "/routines/runs/recent")[0]!.query.toString()).toBe("limit=5");

    await expect(routinesApi.listRuns("r1", 7)).resolves.toEqual({ runs: [run("run-2", "r1")] });
    expect(api.sent("GET", "/routines/r1/runs")[0]!.query.toString()).toBe("limit=7");
  });

  it("deletes by id", async () => {
    api.delete("/routines/:id", (): Deleted => ({ deleted: true }));
    await expect(routinesApi.remove("r1")).resolves.toEqual({ deleted: true });
    expect(api.sent("DELETE", "/routines/r1")).toHaveLength(1);
  });
});
