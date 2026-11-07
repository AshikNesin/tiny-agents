/**
 * The `bot-builder` capability (issue #149): `create_bot` always waits for
 * the owner's approval — even when the tool is set to `allow` — and the
 * store's refusals reach the model.
 */
import type { Context as PiContext } from "@earendil-works/pi-ai";
import { until } from "../../fixtures/until";
import { afterEach, describe, expect, it } from "vite-plus/test";
import type { AgentRuntime } from "../../../../packages/agent/src/runtime";
import {
  createBotBuilderCapability,
  type BotCreationStore,
  type NewBotInput,
} from "../../../../packages/agent/src/toolkits/bot-builder";
import {
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  openTestRuntime,
  TEST_MODEL,
} from "../../../../packages/agent/src/testing";
import type { ChatEvent, ChatState } from "../../../../packages/agent/src/types";

const ARGS = {
  name: "Engineer - Limitless",
  description: "Limitless Visuals mobile app",
  instructions: "You help the owner with the Limitless Visuals app.",
};

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

/** A bot that calls create_bot once, then answers; tool results land in `results`. */
async function openBuilder(
  store: BotCreationStore,
  args: Parameters<typeof fauxToolCall>[1] = ARGS,
) {
  const results: string[] = [];
  const runtime = await openTestRuntime({
    storePath: ":memory:",
    capabilities: [createBotBuilderCapability(store)],
    respondWith: (context: PiContext) => {
      const last = context.messages.at(-1);
      if (last?.role === "toolResult") {
        results.push(
          Array.isArray(last.content)
            ? last.content.map((b) => (b.type === "text" ? b.text : "")).join("")
            : "",
        );
        return fauxAssistantMessage([fauxText("done")]);
      }
      return {
        ...fauxAssistantMessage([fauxToolCall("create_bot", args)]),
        stopReason: "toolUse" as const,
      };
    },
  });
  runtimes.push(runtime);
  const ref = await runtime.createConversation({
    modelId: TEST_MODEL,
    systemPrompt: "",
    capabilities: { enabled: ["bot-builder"], permissions: { create_bot: "allow" } },
  });
  const events: ChatEvent[] = [];
  await runtime.watchChat(ref, (batch) => {
    events.push(...batch);
  });
  await runtime.submit(ref, { requestId: "r1", text: "make me a bot" });
  const call = await until(
    () =>
      reduce(events)
        ?.messages.flatMap((m) => m.toolCalls ?? [])
        .find((c) => c.status === "awaiting_approval"),
    "approval",
  );
  return { runtime, ref, call, results };
}

describe("bot-builder capability", () => {
  it("create_bot always asks, even when set to allow, then creates", async () => {
    const created: NewBotInput[] = [];
    const store: BotCreationStore = {
      async create(_conversation, input) {
        created.push(input);
        return {
          status: "created",
          bot: { id: "b1", name: input.name, modelId: "m1", url: "/chats/b1" },
        };
      },
    };
    const { runtime, ref, call, results } = await openBuilder(store, {
      ...ARGS,
      name: "  Engineer - Limitless ",
    });
    expect(created).toEqual([]);
    await runtime.decideApproval(ref, call.taskId!, "approved");
    await until(() => results.length === 1, "result");
    expect(created).toEqual([ARGS]);
    expect(results[0]).toContain('Created bot "Engineer - Limitless"');
    expect(results[0]).toContain("/chats/b1");
  });

  it("creates nothing when the owner denies", async () => {
    const created: NewBotInput[] = [];
    const store: BotCreationStore = {
      async create(_conversation, input) {
        created.push(input);
        return { status: "disabled" };
      },
    };
    const { runtime, ref, call, results } = await openBuilder(store);
    await runtime.decideApproval(ref, call.taskId!, "denied");
    await until(() => results.length === 1, "result");
    expect(created).toEqual([]);
  });

  it.each([
    ["unattended", "owner's own turns"],
    ["shared", "shared with guests"],
    ["name_taken", "already exists"],
  ] as const)("reports a %s refusal to the model", async (status, text) => {
    const store: BotCreationStore = { create: async () => ({ status }) };
    const { runtime, ref, call, results } = await openBuilder(store);
    await runtime.decideApproval(ref, call.taskId!, "approved");
    await until(() => results.length === 1, "refusal");
    expect(results[0]).toContain(text);
  });

  it("lists the available models when the model is unknown", async () => {
    const store: BotCreationStore = {
      create: async () => ({ status: "unknown_model", models: ["m1", "m2"] }),
    };
    const { runtime, ref, call, results } = await openBuilder(store, { ...ARGS, model: "nope" });
    await runtime.decideApproval(ref, call.taskId!, "approved");
    await until(() => results.length === 1, "refusal");
    expect(results[0]).toContain('Unknown model "nope"');
    expect(results[0]).toContain("m1, m2");
  });
});
