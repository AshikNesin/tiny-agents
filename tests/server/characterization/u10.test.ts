/**
 * Characterization of behavior-register row U10: the faux dev runtime runs
 * dry after 1000 responses; the test runtime after 500.
 * Preserve: this pins today's behavior, quirk included; change it only with
 * a signed-off register row.
 *
 * The queues are filled once, at open. Rather than run 500 real turns, the
 * test records the queue each runtime fills, then leaves only the last
 * response queued: the turn after it is the one that runs dry.
 */
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
/** Every faux provider opened, with the queue it was first filled with. */
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
  // The dev runtime registers itself as the app's; this closes and unbinds it.
  await closeAgentRuntime();
  opened.length = 0;
});

/** Send `text` and wait for the turn to end; returns the reply message. */
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

    // As if 499 turns had run: the 500th answers, the 501st finds nothing queued.
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
