import { beforeEach, describe, expect, it } from "vite-plus/test";
import { botsApi } from "@/lib/bots-api";
import type { CapabilityInfo, CapabilityList } from "../../../apps/web/src/shared/api/bots";
import { fakeApi } from "../fakes/api";

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
    api.get("/capabilities", (): CapabilityList => ({ capabilities: [capability] }));
    await expect(botsApi.capabilities()).resolves.toEqual([capability]);
  });

  it("survives an empty response", async () => {
    api.get("/capabilities", () => ({}));
    await expect(botsApi.capabilities()).resolves.toEqual([]);
  });
});
