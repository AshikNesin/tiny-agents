import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { AgentRuntime } from "../../../packages/agent/src/runtime";
import { openTestRuntime, TEST_MODEL } from "../../../packages/agent/src/testing";
import {
  closeAgentRuntime,
  openFauxAgentRuntime,
} from "../../../apps/web/src/server/api/bots/bots.runtime";
import { until } from "../fixtures";

type Faux = {
  setResponses(responses: unknown[]): void;
  getPendingResponseCount(): number;
};
const opened: Array<{ faux: Faux; filled: unknown[] }> = [];

vi.mock("@earendil-works/pi-ai/providers/faux", async (importOriginal) => {
  const original = await importOriginal<typeof import("@earendil-works/pi-ai/providers/faux")>();
  return {
    ...original,
    fauxProvider: (...args: Parameters<typeof original.fauxProvider>) => {
      const faux = original.fauxProvider(...args);
      const entry = { faux: faux as unknown as Faux, filled: [] as unknown[] };
      const setResponses = faux.setResponses.bind(faux);
      faux.setResponses = (responses) => {
        if (entry.filled.length === 0) entry.filled = [...responses];
        setResponses(responses);
      };
      opened.push(entry);
      return faux;
    },
  };
});

const runtimes: AgentRuntime[] = [];
afterEach(async () => {
  await Promise.allSettled(runtimes.splice(0).map((runtime) => runtime.close()));
  await closeAgentRuntime();
  opened.length = 0;
});

async function turn(
  runtime: AgentRuntime,
  ref: Awaited<ReturnType<AgentRuntime["createConversation"]>>,
  text: string,
) {
  await runtime.submit(ref, { requestId: text, text });
  const state = await until(async () => {
    const read = await runtime.readChat(ref);
    const last = read.messages.at(-1);
    return !read.busy && last?.role === "assistant" && last.status !== "streaming"
      ? read
      : undefined;
  }, `the reply to ${text}`);
  return state.messages.at(-1)!;
}

describe("U10: the faux queues", () => {
  it("the test runtime holds 500 responses, and the 501st turn fails", async () => {
    const runtime = await openTestRuntime({ storePath: ":memory:" });
    runtimes.push(runtime);
    expect(opened).toHaveLength(1);
    const [{ faux, filled }] = opened as [(typeof opened)[number]];
    expect(filled).toHaveLength(500);
    expect(faux.getPendingResponseCount()).toBe(500);

    faux.setResponses(filled.slice(499));
    const ref = await runtime.createConversation({ modelId: TEST_MODEL, systemPrompt: "" });
    expect(await turn(runtime, ref, "five hundredth")).toMatchObject({
      status: "done",
      text: "Echo: five hundredth",
    });
    expect(faux.getPendingResponseCount()).toBe(0);
    expect(await turn(runtime, ref, "one more")).toMatchObject({
      status: "error",
      error: expect.stringContaining("No more faux responses queued"),
    });
  });

  it("the faux dev runtime holds 1000 responses", async () => {
    const runtime = await openFauxAgentRuntime(":memory:", { env: {} });
    expect(opened).toHaveLength(1);
    const [{ faux, filled }] = opened as [(typeof opened)[number]];
    expect(filled).toHaveLength(1000);
    expect(faux.getPendingResponseCount()).toBe(1000);

    faux.setResponses(filled.slice(999));
    const ref = await runtime.createConversation({ modelId: TEST_MODEL, systemPrompt: "" });
    expect(await turn(runtime, ref, "thousandth")).toMatchObject({
      status: "done",
      text: "Echo: thousandth",
    });
    expect(await turn(runtime, ref, "one more")).toMatchObject({
      status: "error",
      error: expect.stringContaining("No more faux responses queued"),
    });
  });
});
