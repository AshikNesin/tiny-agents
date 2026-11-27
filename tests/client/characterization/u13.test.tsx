import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { HarnessInfo } from "@/lib/code/api";
import { useCodeStore } from "@/store/code";
import { ApiFailure, fakeApi } from "../fakes/api";

const streams = vi.hoisted(() => ({ opened: [] as Array<(event: unknown) => void> }));
vi.mock("@/lib/sse", () => ({
  subscribeSse: (_path: string, onEvent: (event: unknown) => void) => {
    streams.opened.push(onEvent);
    return { close: () => undefined };
  },
}));

const harness = (id: string): HarnessInfo => ({
  id,
  kind: id,
  label: id,
  status: { state: "connected" },
  capabilities: {} as HarnessInfo["capabilities"],
  commands: [],
  ssh: { host: null, user: null, port: null, keyFile: null },
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
let api: ReturnType<typeof fakeApi>;
const statusRequests = () => api.sent("GET", "/code/status");
let connected = 0;
const connect = () => {
  connected += 1;
  useCodeStore.getState().connect();
};

beforeEach(() => {
  api = fakeApi();
  streams.opened.length = 0;
  useCodeStore.setState({ harnesses: null, statuses: {}, threads: null });
});
afterEach(() => {
  for (; connected > 0; connected--) useCodeStore.getState().disconnect();
});

describe("U13: the client's harness list", () => {
  it("stays [] after one failed /code/status, while the shell stays mounted", async () => {
    api.get("/code/status", () => {
      throw new ApiFailure(502, "Bad gateway");
    });

    connect();
    await vi.waitFor(() => expect(useCodeStore.getState().harnesses).toEqual([]));
    expect(streams.opened).toHaveLength(0);

    connect();
    connect();
    await flush();
    expect(statusRequests()).toHaveLength(1);
    expect(useCodeStore.getState().harnesses).toEqual([]);

    api.get("/code/status", () => ({ harnesses: [harness("shelley")] }));
    for (; connected > 0; connected--) useCodeStore.getState().disconnect();
    connect();
    await vi.waitFor(() =>
      expect(useCodeStore.getState().harnesses?.map((h) => h.id)).toEqual(["shelley"]),
    );
    expect(statusRequests()).toHaveLength(2);
  });

  it("keeps the boot-time list when the live stream reports a harness added later", async () => {
    api.get("/code/status", () => ({ harnesses: [harness("shelley")] }));
    connect();
    await vi.waitFor(() => expect(streams.opened).toHaveLength(1));

    streams.opened[0]!({
      type: "status",
      instances: { shelley: { state: "connected" }, "claude-code": { state: "connected" } },
    });
    expect(Object.keys(useCodeStore.getState().statuses)).toEqual(["shelley", "claude-code"]);
    expect(useCodeStore.getState().harnesses?.map((h) => h.id)).toEqual(["shelley"]);
    expect(statusRequests()).toHaveLength(1);
  });
});
