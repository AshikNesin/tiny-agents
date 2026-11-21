import type { Context as PiContext } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vite-plus/test";
import type { AgentRuntime } from "../../../packages/agent/src/runtime";
import {
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  openTestRuntime,
  TEST_MODEL,
} from "../../../packages/agent/src/testing";
import { createSandboxToolkit } from "../../../packages/agent/src/toolkits/sandbox";
import { createWebToolkit } from "../../../packages/agent/src/toolkits/web";
import { sandboxConnection } from "../../../apps/web/src/server/api/bots/sandbox-host";
import { appEnv } from "../../../apps/web/src/server/env";
import { until } from "../fixtures";

const runtimes: AgentRuntime[] = [];
afterEach(async () => {
  await Promise.allSettled(runtimes.splice(0).map((runtime) => runtime.close()));
});

function toolResultText(context: PiContext): string | undefined {
  const last = context.messages.at(-1);
  if (last?.role !== "toolResult") return undefined;
  return last.content.map((b) => (b.type === "text" ? b.text : "")).join("");
}

function toolsOffered(context: PiContext): string[] {
  const tools = new Set<string>();
  for (const message of context.messages) {
    if (message.role !== "system") continue;
    for (const tool of message.toolsRemoved ?? []) tools.delete(tool.name);
    for (const tool of message.toolsAdded ?? []) tools.add(tool.name);
  }
  return [...tools].sort();
}

describe("C20: the sandbox toolkit with no sandbox", () => {
  it("offers run_command, read_file and write_file to the model, which then fail", async () => {
    const connection = sandboxConnection(appEnv({}));
    expect(connection).toBeUndefined();
    const sandbox = createSandboxToolkit({ connection });
    expect(sandbox.setupHint).toBe("Set SANDBOX_HOST to enable the sandbox.");

    const offered: string[][] = [];
    const runtime = await openTestRuntime({
      storePath: ":memory:",
      capabilities: [sandbox, createWebToolkit({})],
      respondWith: (context) => {
        offered.push(toolsOffered(context));
        const result = toolResultText(context);
        if (result !== undefined) return fauxAssistantMessage([fauxText(`RESULT:${result}`)]);
        return {
          ...fauxAssistantMessage([fauxToolCall("read_file", { path: "/etc/hostname" })]),
          stopReason: "toolUse" as const,
        };
      },
    });
    runtimes.push(runtime);
    const ref = await runtime.createConversation({
      modelId: TEST_MODEL,
      systemPrompt: "",
      capabilities: { enabled: ["sandbox", "web"], permissions: {} },
    });
    await runtime.submit(ref, { requestId: "r1", text: "read the hostname" });
    const reply = await until(async () => {
      const state = await runtime.readChat(ref);
      const last = state.messages.at(-1);
      return !state.busy && last?.text.startsWith("RESULT:") ? last.text : undefined;
    }, "the reply after read_file");

    expect(offered[0]).toEqual(expect.arrayContaining(["read_file", "run_command", "write_file"]));
    expect(offered[0]).not.toContain("web_search");
    expect(offered[0]).not.toContain("web_fetch");
    expect(reply).toBe("RESULT:Sandbox is not configured: set SANDBOX_HOST on the server.");
  }, 15_000);
});
