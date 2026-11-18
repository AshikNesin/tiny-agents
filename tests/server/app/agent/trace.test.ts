/**
 * Traces (issue #363): a conversation's model and tool calls, read back from
 * the entries it stores, with the conversation's usage totals.
 */
import { describe, expect, it } from "vite-plus/test";
import type { Context as PiContext } from "@earendil-works/pi-ai";
import { Type } from "@earendil-works/pi-ai";
import { until } from "../../fixtures/until";
import { finishedReplyTo } from "../../../../packages/agent/src/replies";
import { defineToolkit, tool } from "../../../../packages/agent/src/toolkit";
import {
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  openTestRuntime,
  TEST_MODEL,
  TEST_PROVIDER,
} from "../../../../packages/agent/src/testing";

const pingToolkit = defineToolkit({
  id: "ping",
  name: "Ping",
  description: "Ping",
  tools: [
    tool({
      name: "ping",
      label: "Pinged",
      askLabel: "ping",
      summary: "Ping",
      description: "Ping once",
      policy: { readOnly: true },
      parameters: Type.Object({}),
      replay: "safe",
      execute: async () => ({ output: [{ type: "text", text: "pong" }] }),
    }),
  ],
});

/** Calls `ping` once after each user message, then answers. */
function respond(context: PiContext) {
  const last = context.messages.at(-1);
  if (last?.role === "toolResult") return fauxAssistantMessage(fauxText("done"));
  return { ...fauxAssistantMessage(fauxToolCall("ping", {})), stopReason: "toolUse" as const };
}

describe("conversation trace", () => {
  it("lists each turn's model and tool calls with usage", async () => {
    const runtime = await openTestRuntime({
      storePath: ":memory:",
      capabilities: [pingToolkit],
      respondWith: respond,
    });
    try {
      const ref = await runtime.createConversation({
        modelId: TEST_MODEL,
        systemPrompt: "",
        capabilities: { enabled: ["ping"], permissions: {} },
      });
      const long = `check   the\nserver ${"x".repeat(400)}`;
      await runtime.submit(ref, { requestId: "one", text: long });
      await until(
        async () => finishedReplyTo(await runtime.readChat(ref), "one").status === "answered",
        "the reply",
      );

      const trace = await runtime.trace(ref);
      expect(trace.turns).toHaveLength(1);
      const [turn] = trace.turns;
      // Whitespace folded, clipped to 200 characters.
      expect(turn.input.startsWith("check the server xxx")).toBe(true);
      expect(turn.input).toHaveLength(200);
      expect(turn.peer).toBe(false);
      expect(turn.steps.map((step) => step.type)).toEqual(["llm", "tool", "llm"]);
      const [first, ping, last] = turn.steps;
      expect(first).toMatchObject({
        type: "llm",
        harness: "pi",
        provider: TEST_PROVIDER,
        model: TEST_MODEL,
        stopReason: "toolUse",
        toolCalls: ["ping"],
      });
      expect(ping).toMatchObject({ type: "tool", name: "ping", error: false });
      expect(last).toMatchObject({ type: "llm", stopReason: "stop", toolCalls: [] });
      if (first.type !== "llm") throw new Error("not a model call");
      expect(first.usage?.input).toBeGreaterThan(0);
      expect(trace.usage.models).toEqual([TEST_MODEL]);

      // The totals are the conversation's pi.usage: both calls' tokens.
      const usage = await runtime.usage(ref);
      expect(trace.usage).toEqual(usage);
      const callInput = turn.steps.reduce(
        (sum, step) => sum + (step.type === "llm" ? (step.usage?.input ?? 0) : 0),
        0,
      );
      expect(usage.input).toBe(callInput);
    } finally {
      await runtime.close();
    }
  });
});
