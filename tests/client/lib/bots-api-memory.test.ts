import { beforeEach, describe, expect, it } from "vite-plus/test";
import { botsApi } from "@/lib/bots-api";
import type { Bot } from "../../../apps/web/src/shared/api/bots";
import type { Deleted } from "../../../apps/web/src/shared/api/common";
import type {
  MemoryList,
  MemoryRecord,
  MemoryResult,
} from "../../../apps/web/src/shared/api/memories";
import { FIXED_NOW, futureIso } from "../../test-clock";
import { fakeApi } from "../fakes/api";

function memory(id: string, overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id,
    botId: "b1",
    text: "Prefers TypeScript",
    category: "preference",
    status: "active",
    source: "manual",
    until: null,
    supersededById: null,
    supersededAt: null,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  };
}

function bot(id: string, overrides: Partial<Bot> = {}): Bot {
  return {
    id,
    name: "Ada",
    description: "",
    systemPrompt: "",
    modelId: "m",
    conversationId: "7",
    chatStartedAt: FIXED_NOW,
    lastReadAt: null,
    lastActivityAt: FIXED_NOW,
    lastMessagePreview: null,
    memoryEnabled: true,
    autoReview: false,
    yoloByDefault: false,
    memoryCapturedThrough: null,
    pinnedAt: null,
    browserProfile: "shared",
    projectId: null,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    toolPermissions: {},
    skillIds: [],
    connectionIds: [],
    connectionCapabilities: [],
    guestIds: [],
    ...overrides,
  };
}

let api: ReturnType<typeof fakeApi>;

beforeEach(() => {
  api = fakeApi();
});

describe("botsApi memory endpoints", () => {
  it("lists memories under the bot with includeArchived", async () => {
    api.get("/bots/:id/memories", ({ query }): MemoryList => ({
      memories:
        query.get("includeArchived") === "true"
          ? [memory("m1"), memory("m2", { status: "archived" })]
          : [memory("m1")],
    }));

    await expect(botsApi.listMemories("b1")).resolves.toEqual({
      memories: [memory("m1"), memory("m2", { status: "archived" })],
    });
    expect(api.sent("GET", "/bots/b1/memories")[0]!.query.toString()).toBe("includeArchived=true");

    await expect(botsApi.listMemories("b1", false)).resolves.toEqual({ memories: [memory("m1")] });
    expect(api.sent("GET", "/bots/b1/memories")[1]!.query.toString()).toBe("includeArchived=false");
  });

  it("creates a manual memory with text, category, and optional until", async () => {
    api.post("/bots/:id/memories", (): MemoryResult => ({ memory: memory("m1") }));

    await expect(
      botsApi.createMemory("b1", { text: "Prefers TypeScript", category: "preference" }),
    ).resolves.toEqual({ memory: memory("m1") });
    expect(api.sent("POST", "/bots/b1/memories")[0]!.body).toEqual({
      text: "Prefers TypeScript",
      category: "preference",
    });

    const until = futureIso(30);
    await botsApi.createMemory("b1", { text: "Visiting Berlin", category: "fact", until });
    expect(api.sent("POST", "/bots/b1/memories")[1]!.body).toEqual({
      text: "Visiting Berlin",
      category: "fact",
      until,
    });
  });

  it("patches a memory by id and sends restore as the lifecycle field", async () => {
    api.patch("/memories/:id", ({ params }): MemoryResult => ({ memory: memory(params.id!) }));

    await expect(botsApi.updateMemory("m1", { text: "renamed" })).resolves.toEqual({
      memory: memory("m1"),
    });
    expect(api.sent("PATCH", "/memories/m1")[0]!.body).toEqual({ text: "renamed" });

    await botsApi.updateMemory("m2", { restore: true });
    expect(api.sent("PATCH", "/memories/m2")[0]!.body).toEqual({ restore: true });
  });

  it("deletes a memory by id", async () => {
    api.delete("/memories/:id", (): Deleted => ({ deleted: true }));
    await expect(botsApi.deleteMemory("m1")).resolves.toEqual({ deleted: true });
    expect(api.sent("DELETE", "/memories/m1")).toHaveLength(1);
  });

  it("toggles memoryEnabled through the bots update path", async () => {
    api.patch("/bots/:id", ({ params }) => bot(params.id!, { memoryEnabled: false }));
    await expect(botsApi.update("b1", { memoryEnabled: false })).resolves.toMatchObject({
      id: "b1",
      memoryEnabled: false,
    });
    expect(api.sent("PATCH", "/bots/b1")[0]!.body).toEqual({ memoryEnabled: false });
  });
});
