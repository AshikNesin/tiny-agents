import type { Context as PiContext } from "@earendil-works/pi-ai";
import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vite-plus/test";
import type { Capability } from "../../../../packages/agent/src/capabilities";
import { ForkPointNotFoundError, type AgentRuntime } from "../../../../packages/agent/src/runtime";
import {
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  openTestRuntime,
  TEST_MODEL,
  type TestRuntimeOptions,
} from "../../../../packages/agent/src/testing";
import type { ChatState } from "../../../../packages/agent/src/types";
import { FIXED_NOW } from "../../../test-clock";
import { until } from "../../fixtures/until";

const runtimes: AgentRuntime[] = [];
afterEach(async () => {
  await Promise.allSettled(runtimes.splice(0).map((runtime) => runtime.close()));
});

async function open(options: Partial<TestRuntimeOptions> = {}) {
  const runtime = await openTestRuntime({ storePath: ":memory:", ...options });
  runtimes.push(runtime);
  return runtime;
}

function whereCapability(): Capability {
  const where = defineTool({
    name: "where",
    description: "Say the conversation's working directory",
    parameters: Type.Object({}),
    replay: "safe",
    execute: async (_args, api, context) => ({
      output: [{ type: "text", text: (await api.agent(context)).cwd ?? "no cwd" }],
    }),
  });
  return {
    id: "where",
    kind: "toolkit",
    name: "Where",
    description: "Reports the working directory",
    extension: defineExtension({ name: "where", tools: [where] }),
    tools: [{ name: "where", label: "Looked", description: "Where", readOnly: true }],
  };
}

function callWhereThenReport(context: PiContext) {
  const last = context.messages.at(-1);
  if (last?.role === "toolResult") {
    const text = last.content.map((block) => (block.type === "text" ? block.text : "")).join("");
    return fauxAssistantMessage(fauxText(`cwd is ${text}`));
  }
  return { ...fauxAssistantMessage(fauxToolCall("where", {})), stopReason: "toolUse" as const };
}

function texts(state: ChatState): string[] {
  return state.messages.map((message) => `${message.role}:${message.text}`);
}

async function answered(runtime: AgentRuntime, ref: number, text: string): Promise<ChatState> {
  return until(async () => {
    const state = await runtime.readChat(ref);
    return !state.busy && state.messages.at(-1)?.text === text ? state : undefined;
  }, `the reply "${text}"`);
}

describe("AgentRuntime working directory", () => {
  it("gives a conversation the cwd it was created with, and the one it is reconfigured to", async () => {
    const runtime = await open({
      capabilities: [whereCapability()],
      respondWith: callWhereThenReport,
    });
    const config = {
      modelId: TEST_MODEL,
      systemPrompt: "",
      capabilities: { enabled: ["where"], permissions: {} },
    };
    const ref = await runtime.createConversation({ ...config, cwd: "/work/app" });
    await runtime.submit(ref, { requestId: "one", text: "where?" });
    await answered(runtime, ref, "cwd is /work/app");

    await runtime.configure(ref, { ...config, cwd: "/work/other" });
    await runtime.submit(ref, { requestId: "two", text: "and now?" });
    await answered(runtime, ref, "cwd is /work/other");

    await runtime.configure(ref, config);
    await runtime.submit(ref, { requestId: "three", text: "still?" });
    await answered(runtime, ref, "cwd is /work/other");

    await runtime.configure(ref, { ...config, cwd: null });
    await runtime.submit(ref, { requestId: "four", text: "cleared?" });
    const state = await answered(runtime, ref, "cwd is no cwd");

    expect(texts(state).filter((text) => text.startsWith("assistant:cwd is"))).toEqual([
      "assistant:cwd is /work/app",
      "assistant:cwd is /work/other",
      "assistant:cwd is /work/other",
      "assistant:cwd is no cwd",
    ]);
  });
});

describe("AgentRuntime.fork", () => {
  it("copies the conversation up to and including the message, and both go on apart", async () => {
    const runtime = await open();
    const ref = await runtime.createConversation({ modelId: TEST_MODEL, systemPrompt: "" });
    await runtime.submit(ref, { requestId: "one", text: "first" });
    await answered(runtime, ref, "Echo: first");
    await runtime.submit(ref, { requestId: "two", text: "second" });
    const source = await answered(runtime, ref, "Echo: second");
    const firstAnswer = source.messages[1]!;

    const fork = await runtime.fork(ref, firstAnswer.id);

    expect(fork).not.toBe(ref);
    expect(texts(await runtime.readChat(fork))).toEqual(["user:first", "assistant:Echo: first"]);
    await runtime.submit(fork, { requestId: "three", text: "another way" });
    const forked = await answered(runtime, fork, "Echo: another way");
    expect(texts(forked)).toEqual([
      "user:first",
      "assistant:Echo: first",
      "user:another way",
      "assistant:Echo: another way",
    ]);
    expect(texts(await runtime.readChat(ref))).toEqual([
      "user:first",
      "assistant:Echo: first",
      "user:second",
      "assistant:Echo: second",
    ]);
  });

  it("includes a user message it forks at, which a continue then answers", async () => {
    const runtime = await open();
    const ref = await runtime.createConversation({ modelId: TEST_MODEL, systemPrompt: "" });
    await runtime.submit(ref, { requestId: "one", text: "first" });
    await answered(runtime, ref, "Echo: first");
    await runtime.submit(ref, { requestId: "two", text: "second" });
    const source = await answered(runtime, ref, "Echo: second");

    const fork = await runtime.fork(ref, source.messages[2]!.id);

    expect(texts(await runtime.readChat(fork))).toEqual([
      "user:first",
      "assistant:Echo: first",
      "user:second",
    ]);
    await runtime.continueReply(fork);
    const forked = await answered(runtime, fork, "Echo: second");
    expect(texts(forked)).toEqual([
      "user:first",
      "assistant:Echo: first",
      "user:second",
      "assistant:Echo: second",
    ]);
  });

  it("refuses a message the conversation does not have", async () => {
    const runtime = await open();
    const ref = await runtime.createConversation({ modelId: TEST_MODEL, systemPrompt: "" });
    await runtime.submit(ref, { requestId: "one", text: "first" });
    await answered(runtime, ref, "Echo: first");

    await expect(runtime.fork(ref, "e999999")).rejects.toBeInstanceOf(ForkPointNotFoundError);
    await expect(runtime.fork(ref, "live")).rejects.toBeInstanceOf(ForkPointNotFoundError);
    await runtime.submit(ref, { requestId: "two", text: "still alive" });
    await answered(runtime, ref, "Echo: still alive");
  });
});

describe("AgentRuntime.compact", () => {
  it("summarizes the conversation with the instructions it was given", async () => {
    const asked: string[] = [];
    const runtime = await open({
      settings: { compaction: { keepRecentTokens: 0 } },
      respondWith: (context) => {
        const prompt = JSON.stringify(context.messages);
        if (prompt.includes("keep the file names")) {
          asked.push("summary");
          return fauxAssistantMessage(fauxText("Summary: two questions about files."));
        }
        return fauxAssistantMessage(fauxText("ok"));
      },
    });
    const ref = await runtime.createConversation({ modelId: TEST_MODEL, systemPrompt: "" });
    await runtime.submit(ref, { requestId: "one", text: "read a.ts" });
    await answered(runtime, ref, "ok");
    await runtime.submit(ref, { requestId: "two", text: "read b.ts" });
    await answered(runtime, ref, "ok");

    await runtime.compact(ref, "keep the file names");

    await until(
      async () =>
        (await runtime.readChat(ref)).messages.some((message) => message.marker === "compaction"),
      "the compaction marker",
    );
    expect(asked).toEqual(["summary"]);
  });
});

describe("queued messages", () => {
  it("carry when they were sent", { timeout: 20_000 }, async () => {
    const runtime = await open({
      tokensPerSecond: 5,
      reply: (text) => `Reply to ${text}, padded for a slow stream`,
    });
    const ref = await runtime.createConversation({ modelId: TEST_MODEL, systemPrompt: "" });
    await runtime.submit(ref, { requestId: "one", text: "start" });
    await until(() => runtime.isBusy(ref), "the run to start");

    await runtime.submit(ref, { requestId: "two", text: "later", whenBusy: "followUp" });

    const state = await until(async () => {
      const now = await runtime.readChat(ref);
      return now.queued.length > 0 ? now : undefined;
    }, "the queued message");
    expect(state.queued).toEqual([
      { requestId: "two", mode: "followUp", text: "later", createdAt: Date.parse(FIXED_NOW) },
    ]);
    await runtime.abort(ref);
  });
});
