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
} from "../../../../packages/agent/src/testing";

function lastToolResult(context: PiContext) {
  for (let i = context.messages.length - 1; i >= 0; i--) {
    const message = context.messages[i];
    if (message.role === "user") return undefined;
    if (message.role === "toolResult") {
      return message.content.map((block) => (block.type === "text" ? block.text : "")).join("");
    }
  }
  return undefined;
}

function pingToolkit(runs: { count: number }) {
  return defineToolkit({
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
        execute: async () => {
          runs.count++;
          return { output: [{ type: "text", text: "pong" }] };
        },
      }),
    ],
  });
}

async function runLoop(wrapUpWhenRefused: boolean) {
  const runs = { count: 0 };
  const runtime = await openTestRuntime({
    storePath: ":memory:",
    capabilities: [pingToolkit(runs)],
    respondWith: (context) => {
      const last = lastToolResult(context);
      if (wrapUpWhenRefused && last?.includes("did not run")) {
        return fauxAssistantMessage(fauxText("Stopped: too many steps."));
      }
      return {
        ...fauxAssistantMessage(fauxToolCall("ping", {})),
        stopReason: "toolUse" as const,
      };
    },
  });
  const ref = await runtime.createConversation({
    modelId: TEST_MODEL,
    systemPrompt: "",
    capabilities: { enabled: ["ping"], permissions: {} },
  });
  return { runtime, ref, runs };
}

describe("run tool-call cap", () => {
  it("refuses tool calls past 150 in one reply, so the model wraps up", async () => {
    const { runtime, ref, runs } = await runLoop(true);
    try {
      await runtime.submit(ref, { requestId: "loop", text: "ping forever" });
      await until(
        async () => finishedReplyTo(await runtime.readChat(ref), "loop").status === "answered",
        "the reply to finish",
        20_000,
      );
      expect(runs.count).toBe(150);
      expect(finishedReplyTo(await runtime.readChat(ref), "loop")).toMatchObject({
        reply: { text: "Stopped: too many steps." },
      });

      await runtime.submit(ref, { requestId: "again", text: "once more" });
      await until(
        async () => finishedReplyTo(await runtime.readChat(ref), "again").status === "answered",
        "the second reply to finish",
        20_000,
      );
      expect(runs.count).toBe(300);
    } finally {
      await runtime.close();
    }
  }, 60_000);

  it("stops a reply that keeps calling tools after the refusals", async () => {
    const { runtime, ref, runs } = await runLoop(false);
    try {
      await runtime.submit(ref, { requestId: "stuck", text: "ping forever" });
      await until(
        async () => {
          const reply = finishedReplyTo(await runtime.readChat(ref), "stuck");
          return reply.status !== "pending" && !runtime.isBusy(ref);
        },
        "the stuck reply to be stopped",
        20_000,
      );
      expect(runs.count).toBe(150);
    } finally {
      await runtime.close();
    }
  }, 60_000);
});
