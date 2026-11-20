import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { codeApi, type HarnessInfo } from "@/lib/code/api";
import { useCodeStore } from "@/store/code";

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
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
let connected = 0;
const connect = () => {
  connected += 1;
  useCodeStore.getState().connect();
};

beforeEach(() => {
  streams.opened.length = 0;
  useCodeStore.setState({ harnesses: null, statuses: {}, threads: null });
});
afterEach(() => {
  for (; connected > 0; connected--) useCodeStore.getState().disconnect();
  vi.restoreAllMocks();
});

describe("U13: the client's harness list", () => {
  it("stays [] after one failed /code/status, while the shell stays mounted", async () => {
    const status = vi.spyOn(codeApi, "status").mockRejectedValueOnce(new Error("502"));
    status.mockResolvedValue({ harnesses: [harness("shelley")] });

    connect();
    await flush();
    expect(useCodeStore.getState().harnesses).toEqual([]);
    expect(streams.opened).toHaveLength(0);

    connect();
    connect();
    await flush();
    expect(status).toHaveBeenCalledTimes(1);
    expect(useCodeStore.getState().harnesses).toEqual([]);

    for (; connected > 0; connected--) useCodeStore.getState().disconnect();
    connect();
    await flush();
    expect(status).toHaveBeenCalledTimes(2);
    expect(useCodeStore.getState().harnesses?.map((h) => h.id)).toEqual(["shelley"]);
  });

  it("keeps the boot-time list when the live stream reports a harness added later", async () => {
    const status = vi
      .spyOn(codeApi, "status")
      .mockResolvedValue({ harnesses: [harness("shelley")] });
    connect();
    await flush();
    expect(streams.opened).toHaveLength(1);

    streams.opened[0]!({
      type: "status",
      instances: { shelley: { state: "connected" }, "claude-code": { state: "connected" } },
    });
    expect(Object.keys(useCodeStore.getState().statuses)).toEqual(["shelley", "claude-code"]);
    expect(useCodeStore.getState().harnesses?.map((h) => h.id)).toEqual(["shelley"]);
    expect(status).toHaveBeenCalledTimes(1);
  });
});
