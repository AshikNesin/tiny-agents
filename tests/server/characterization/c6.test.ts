/**
 * Characterization of behavior-register row C6: switching a bot between
 * engines hides the other engine's history, and `leave()` is permanent even
 * after moving back to a Claude model.
 * Preserve: this pins today's behavior, quirk included; change it only with
 * a signed-off register row.
 */
import { afterEach, describe, expect, it } from "vite-plus/test";
import type { AgentRuntime } from "../../../packages/agent/src/runtime";
import { TEST_MODEL } from "../../../packages/agent/src/testing";
import type { ConversationRef } from "../../../packages/agent/src/types";
import { openEngine } from "../app/agent/engine-harness";
import { until } from "../fixtures";

const runtimes: AgentRuntime[] = [];
afterEach(async () => {
  await Promise.allSettled(runtimes.splice(0).map((runtime) => runtime.close()));
});

async function setup() {
  const engine = await openEngine("claude-code");
  runtimes.push(engine.runtime);
  const onClaude = { modelId: engine.modelId, systemPrompt: "Be brief." };
  const onPi = { modelId: TEST_MODEL, systemPrompt: "Be brief." };
  const texts = async (ref: ConversationRef) =>
    (await engine.runtime.readChat(ref)).messages.map((m) => m.text);
  /** Send and wait for the echo, on whichever engine runs the conversation. */
  const reply = async (ref: ConversationRef, text: string, requestId: string) => {
    await engine.send(ref, { requestId, text });
    await until(async () => {
      const state = await engine.runtime.readChat(ref);
      return !state.busy && state.messages.at(-1)?.text === `Echo: ${text}`;
    }, `the reply to ${text}`);
  };
  return { ...engine, onClaude, onPi, texts, reply };
}

describe("C6: moving a conversation between engines", () => {
  it("hides the Claude plan history on pi, and stays on pi after moving back", async () => {
    const { runtime, worker, onClaude, onPi, texts, reply } = await setup();
    const ref = await runtime.createConversation(onClaude);
    await reply(ref, "on the plan", "r1");
    expect(await texts(ref)).toEqual(["on the plan", "Echo: on the plan"]);

    // The bot moves to a pi model: the Claude plan transcript is gone from reads.
    await runtime.configure(ref, onPi);
    expect(await texts(ref)).toEqual([]);
    await reply(ref, "on pi", "r2");
    expect(await texts(ref)).toEqual(["on pi", "Echo: on pi"]);

    // Back on the Claude model: the conversation stays on pi for good.
    await runtime.configure(ref, onClaude);
    await reply(ref, "back on the plan", "r3");
    expect(await texts(ref)).toEqual([
      "on pi",
      "Echo: on pi",
      "back on the plan",
      "Echo: back on the plan",
    ]);
    expect(worker.turns.map((turn) => turn.text)).toEqual(["on the plan"]);
  }, 20_000);

  it("hides the pi history once a pi conversation moves onto the Claude plan", async () => {
    const { runtime, worker, onClaude, onPi, texts, reply } = await setup();
    const ref = await runtime.createConversation(onPi);
    await reply(ref, "on pi", "r1");
    expect(await texts(ref)).toEqual(["on pi", "Echo: on pi"]);

    await runtime.configure(ref, onClaude);
    expect(await texts(ref)).toEqual([]);
    await reply(ref, "on the plan", "r2");
    expect(await texts(ref)).toEqual(["on the plan", "Echo: on the plan"]);
    expect(worker.turns.map((turn) => turn.text)).toEqual(["on the plan"]);
  }, 20_000);
});
