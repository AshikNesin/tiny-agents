import { describe, expect, it } from "vite-plus/test";
import { Type } from "typebox";
import { until } from "../../fixtures/until";
import { finishedReplyTo } from "../../../../packages/agent/src/replies";
import { defineToolkit, tool } from "../../../../packages/agent/src/toolkit";
import { openEngine, watch } from "./engine-harness";

function pingToolkit(runs: { count: number }) {
  return defineToolkit({
    id: "ping",
    name: "Ping",
    description: "Ping",
    tools: [
      tool({
        name: "read_ping",
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

async function openLoopingEngine() {
  const runs = { count: 0 };
  const engine = await openEngine("claude-code", { capabilities: [pingToolkit(runs)] });
  const ref = await engine.runtime.createConversation({
    modelId: engine.modelId,
    systemPrompt: "",
    capabilities: { enabled: ["ping"], permissions: {} },
  });
  return { engine, ref, runs };
}

describe("run tool-call cap on the Claude Code engine", () => {
  const runtimes: { close: () => Promise<void> }[] = [];
  const stopAfter = async () => {
    await Promise.allSettled(runtimes.splice(0).map((runtime) => runtime.close()));
  };

  it("refuses tool calls past 150 in one reply, so the model wraps up", async () => {
    const { engine, ref, runs } = await openLoopingEngine();
    runtimes.push(engine.runtime);
    try {
      const chat = await watch(engine.runtime, ref);
      await engine.send(ref, { requestId: "loop", text: "read_ping forever" });
      await until(
        async () =>
          finishedReplyTo(await engine.runtime.readChat(ref), "loop").status === "answered",
        "the reply to finish",
        20_000,
      );
      expect(runs.count).toBe(150);
      expect(finishedReplyTo(await engine.runtime.readChat(ref), "loop")).toMatchObject({
        reply: { text: "Stopped: too many steps." },
      });

      await engine.send(ref, { requestId: "again", text: "read_ping forever" });
      await until(
        async () =>
          finishedReplyTo(await engine.runtime.readChat(ref), "again").status === "answered",
        "the second reply to finish",
        20_000,
      );
      expect(runs.count).toBe(300);
      await chat.stop();
    } finally {
      await stopAfter();
    }
  }, 60_000);

  it("stops a reply that keeps calling tools after the refusals", async () => {
    const { engine, ref, runs } = await openLoopingEngine();
    runtimes.push(engine.runtime);
    try {
      await engine.send(ref, { requestId: "stuck", text: "read_ping stuck" });
      await until(
        async () => {
          const reply = finishedReplyTo(await engine.runtime.readChat(ref), "stuck");
          return reply.status !== "pending" && !engine.runtime.isBusy(ref) ? reply : undefined;
        },
        "the stuck reply to be stopped",
        20_000,
      );
      expect(runs.count).toBe(150);
      expect(engine.worker.turns).toHaveLength(1);
    } finally {
      await stopAfter();
    }
  }, 60_000);
});
