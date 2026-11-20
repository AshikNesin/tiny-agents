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

import { botsApi } from "@/lib/bots-api";

describe("botsApi memory endpoints", () => {
  it("lists memories under the bot with includeArchived", async () => {
    await botsApi.listMemories("b1");
    expect(getMock).toHaveBeenCalledWith("/bots/b1/memories", { includeArchived: true });

    await botsApi.listMemories("b1", false);
    expect(getMock).toHaveBeenLastCalledWith("/bots/b1/memories", { includeArchived: false });
  });

  it("creates a manual memory with text, category, and optional until", async () => {
    await botsApi.createMemory("b1", { text: "Prefers TypeScript", category: "preference" });
    expect(postMock).toHaveBeenCalledWith("/bots/b1/memories", {
      text: "Prefers TypeScript",
      category: "preference",
    });

    await botsApi.createMemory("b1", {
      text: "Visiting Berlin",
      category: "fact",
      until: "2026-11-01T00:00:00.000Z",
    });
    expect(postMock).toHaveBeenLastCalledWith("/bots/b1/memories", {
      text: "Visiting Berlin",
      category: "fact",
      until: "2026-11-01T00:00:00.000Z",
    });
  });

  it("patches a memory by id and sends restore as the lifecycle field", async () => {
    await botsApi.updateMemory("m1", { text: "renamed" });
    expect(patchMock).toHaveBeenCalledWith("/memories/m1", { text: "renamed" });

    await botsApi.updateMemory("m2", { restore: true });
    expect(patchMock).toHaveBeenLastCalledWith("/memories/m2", { restore: true });
  });

  it("deletes a memory by id", async () => {
    await botsApi.deleteMemory("m1");
    expect(deleteMock).toHaveBeenCalledWith("/memories/m1");
  });

  it("toggles memoryEnabled through the bots update path", async () => {
    await botsApi.update("b1", { memoryEnabled: false });
    expect(patchMock).toHaveBeenCalledWith("/bots/b1", { memoryEnabled: false });
  });
});
