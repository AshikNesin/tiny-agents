import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { CapabilityInfo, CapabilityList } from "../../../apps/web/src/shared/api/bots";
import { ApiFailure, fakeApi } from "../fakes/api";

async function freshBotsApi() {
  vi.resetModules();
  const { botsApi } = await import("@/lib/bots-api");
  return botsApi;
}

const capability: CapabilityInfo = {
  id: "tasks",
  kind: "toolkit",
  name: "Tasks",
  description: "",
  tools: [],
};

let api: ReturnType<typeof fakeApi>;

beforeEach(() => {
  api = fakeApi();
});

describe("botsApi.capabilities", () => {
  it("returns the array, not the { capabilities } wrapper", async () => {
    const botsApi = await freshBotsApi();
    api.get("/capabilities", (): CapabilityList => ({ capabilities: [capability] }));
    await expect(botsApi.capabilities()).resolves.toEqual([capability]);
  });

  it("survives an empty response", async () => {
    const botsApi = await freshBotsApi();
    api.get("/capabilities", () => ({}));
    await expect(botsApi.capabilities()).resolves.toEqual([]);
  });

  it("serves every caller from one request (issue #7)", async () => {
    const botsApi = await freshBotsApi();
    api.get("/capabilities", (): CapabilityList => ({ capabilities: [capability] }));
    await Promise.all([botsApi.capabilities(), botsApi.capabilities()]);
    await botsApi.capabilities();
    expect(api.requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      "GET /capabilities",
    ]);
  });

  it("retries after a rejection instead of caching the failure", async () => {
    const botsApi = await freshBotsApi();
    api.get("/capabilities", () => {
      throw new ApiFailure(503, "offline");
    });
    await expect(botsApi.capabilities()).rejects.toThrow("offline");
    api.get("/capabilities", (): CapabilityList => ({ capabilities: [capability] }));
    await expect(botsApi.capabilities()).resolves.toEqual([capability]);
    expect(api.sent("GET", "/capabilities")).toHaveLength(2);
  });
});
