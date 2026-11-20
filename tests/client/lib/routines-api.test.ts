import { describe, expect, it, vi } from "vite-plus/test";

const getMock = vi.fn().mockResolvedValue(undefined);
const postMock = vi.fn().mockResolvedValue(undefined);
const patchMock = vi.fn().mockResolvedValue(undefined);
const deleteMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@groot/shell/lib/api", () => ({
  apiClient: {
    get: (...args: unknown[]) => getMock(...args),
    post: (...args: unknown[]) => postMock(...args),
    patch: (...args: unknown[]) => patchMock(...args),
    delete: (...args: unknown[]) => deleteMock(...args),
  },
}));

import { routinesApi } from "@/lib/routines-api";

const intervalSchedule = { kind: "interval", minutes: 15 } as const;

describe("routinesApi", () => {
  it("lists routines at the collection root", async () => {
    await routinesApi.list();
    expect(getMock).toHaveBeenCalledWith("/routines");
  });

  it("creates with the schedule union in the body", async () => {
    await routinesApi.create({
      botId: "b1",
      name: "digest",
      prompt: "Summarize HN.",
      schedule: intervalSchedule,
    });
    expect(postMock).toHaveBeenCalledWith("/routines", {
      botId: "b1",
      name: "digest",
      prompt: "Summarize HN.",
      schedule: intervalSchedule,
    });
  });

  it("patches updates and sends enabled toggles as the only field", async () => {
    await routinesApi.update("r1", { name: "renamed" });
    expect(patchMock).toHaveBeenCalledWith("/routines/r1", { name: "renamed" });

    await routinesApi.update("r2", { enabled: false });
    expect(patchMock).toHaveBeenCalledWith("/routines/r2", { enabled: false });
  });

  it("posts lifecycle actions to their sub-routes", async () => {
    await routinesApi.pause("r1");
    expect(postMock).toHaveBeenCalledWith("/routines/r1/pause");

    await routinesApi.resume("r1");
    expect(postMock).toHaveBeenCalledWith("/routines/r1/resume");

    await routinesApi.runNow("r1");
    expect(postMock).toHaveBeenCalledWith("/routines/r1/run");
  });

  it("requests recent runs with a limit and per-routine runs by id", async () => {
    await routinesApi.recentRuns(5);
    expect(getMock).toHaveBeenCalledWith("/routines/runs/recent", { limit: 5 });

    await routinesApi.listRuns("r1", 7);
    expect(getMock).toHaveBeenCalledWith("/routines/r1/runs", { limit: 7 });
  });

  it("deletes by id", async () => {
    await routinesApi.remove("r1");
    expect(deleteMock).toHaveBeenCalledWith("/routines/r1");
  });
});
