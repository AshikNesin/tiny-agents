/**
 * The `self-improve` capability: the bot's current instructions render as a
 * prompt section, and `update_instructions` always waits for the owner's
 * approval — even when the tool is set to `allow`.
 */
import type { Context as PiContext } from "@earendil-works/pi-ai";
import { loaded } from "../../fixtures/loaded-tools";
import { until } from "../../fixtures/until";
import { afterEach, describe, expect, it } from "vite-plus/test";
import type { AgentRuntime } from "../../../../packages/agent/src/runtime";
import {
  createSelfImproveCapability,
  type InstructionsStore,
} from "../../../../packages/agent/src/toolkits/self-improve";
import {
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  openTestRuntime,
  TEST_MODEL,
} from "../../../../packages/agent/src/testing";
import type { ChatEvent, ChatState } from "../../../../packages/agent/src/types";

const PROMPT = "You are a helpful assistant.";

function memoryInstructions() {
  const prompts = new Map<number, string>();
  const applied: { instructions?: string; append?: string }[] = [];
  const store: InstructionsStore = {
    async read(conversation) {
      return prompts.get(conversation) ?? "";
    },
    async update(conversation, input) {
      applied.push(input);
      const prompt =
        input.instructions !== undefined
          ? input.instructions
          : input.append !== undefined
            ? [prompts.get(conversation) ?? "", input.append].filter(Boolean).join("\n\n")
            : (prompts.get(conversation) ?? "");
      prompts.set(conversation, prompt);
      return { status: "updated", prompt };
    },
  };
  return { store, prompts, applied };
}

function reduce(events: ChatEvent[]): ChatState | undefined {
  let state: ChatState | undefined;
  for (const event of events) {
    if (event.type === "snapshot") state = structuredClone(event.state);
    else if (state && event.type === "upsert") {
      const i = state.messages.findIndex((m) => m.id === event.message.id);
      if (i >= 0) state.messages[i] = event.message;
      else state.messages.push(event.message);
    } else if (state && event.type === "busy") state.busy = event.busy;
  }
  return state;
}

const runtimes: AgentRuntime[] = [];
afterEach(async () => {
  await Promise.allSettled(runtimes.splice(0).map((r) => r.close()));
});

describe("self-improve capability", () => {
  it("renders the bot's current instructions as a prompt section", async () => {
    const { store } = memoryInstructions();
    store.read = async () => PROMPT;
    const prompts: string[] = [];
    const runtime = await openTestRuntime({
      storePath: ":memory:",
      capabilities: [loaded(createSelfImproveCapability(store))],
      respondWith: (context: PiContext) => {
        prompts.push(JSON.stringify(context));
        return fauxAssistantMessage([fauxText("ok")]);
      },
    });
    runtimes.push(runtime);
    const ref = await runtime.createConversation({
      modelId: TEST_MODEL,
      systemPrompt: "",
      capabilities: { enabled: ["self-improve"], permissions: {} },
    });
    await runtime.submit(ref, { requestId: "r1", text: "hi" });
    await until(() => prompts.length > 0, "prompt");
    expect(prompts[0]).toContain("Your current instructions");
    expect(prompts[0]).toContain(PROMPT);
  });

  it("update_instructions always asks, even when set to allow", async () => {
    const { store, applied } = memoryInstructions();
    const runtime = await openTestRuntime({
      storePath: ":memory:",
      capabilities: [loaded(createSelfImproveCapability(store))],
      respondWith: (context: PiContext) =>
        context.messages.at(-1)?.role === "toolResult"
          ? fauxAssistantMessage([fauxText("done")])
          : {
              ...fauxAssistantMessage([
                fauxToolCall("update_instructions", {
                  instructions: "You are a pirate.",
                }),
              ]),
              stopReason: "toolUse" as const,
            },
    });
    runtimes.push(runtime);
    const ref = await runtime.createConversation({
      modelId: TEST_MODEL,
      systemPrompt: PROMPT,
      capabilities: { enabled: ["self-improve"], permissions: { update_instructions: "allow" } },
    });
    const events: ChatEvent[] = [];
    await runtime.watchChat(ref, (batch) => {
      events.push(...batch);
    });
    await runtime.submit(ref, { requestId: "r1", text: "talk like a pirate from now on" });
    const call = await until(
      () =>
        reduce(events)
          ?.messages.flatMap((m) => m.toolCalls ?? [])
          .find((c) => c.status === "awaiting_approval"),
      "approval",
    );
    expect(applied).toEqual([]);
    await runtime.decideApproval(ref, call.taskId!, "approved");
    await until(() => applied.length === 1, "apply");
    expect(applied[0]).toEqual({ instructions: "You are a pirate." });
  });

  it("reports unattended refusals to the model", async () => {
    const store: InstructionsStore = {
      read: async () => PROMPT,
      update: async () => ({ status: "unattended" }),
    };
    const results: string[] = [];
    const runtime = await openTestRuntime({
      storePath: ":memory:",
      capabilities: [loaded(createSelfImproveCapability(store))],
      respondWith: (context: PiContext) => {
        const last = context.messages.at(-1);
        if (last?.role === "toolResult") {
          const text = Array.isArray(last.content)
            ? last.content.map((b) => (b.type === "text" ? b.text : "")).join("")
            : "";
          results.push(text);
          return fauxAssistantMessage([fauxText("done")]);
        }
        return {
          ...fauxAssistantMessage([
            fauxToolCall("update_instructions", { append: "Always be brief." }),
          ]),
          stopReason: "toolUse" as const,
        };
      },
    });
    runtimes.push(runtime);
    const ref = await runtime.createConversation({
      modelId: TEST_MODEL,
      systemPrompt: PROMPT,
      capabilities: { enabled: ["self-improve"], permissions: {} },
    });
    const events: ChatEvent[] = [];
    await runtime.watchChat(ref, (batch) => {
      events.push(...batch);
    });
    await runtime.submit(ref, { requestId: "r1", text: "be brief" });
    // The owner approves (a routine or peer turn asked); the store still refuses.
    const call = await until(
      () =>
        reduce(events)
          ?.messages.flatMap((m) => m.toolCalls ?? [])
          .find((c) => c.status === "awaiting_approval"),
      "approval",
    );
    await runtime.decideApproval(ref, call.taskId!, "approved");
    await until(() => results.length === 1, "refusal");
    expect(results[0]).toContain("owner's own turns");
  });
});
