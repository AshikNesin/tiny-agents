import { until } from "../../fixtures/until";
import { afterEach, describe, expect, it } from "vite-plus/test";
import type { Context as PiContext, JsonObject, JsonValue } from "@earendil-works/pi-ai";
import type { AgentRuntime } from "../../../../packages/agent/src/runtime";
import {
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  openTestRuntime,
  TEST_MODEL,
} from "../../../../packages/agent/src/testing";
import type { ChatEvent, ChatState, ChatToolCall } from "../../../../packages/agent/src/types";

const QUESTIONS: JsonValue = [
  { question: "Which database?", options: [{ label: "Postgres" }, { label: "SQLite" }] },
];

function textOf(message: { content: string | { type: string; text?: string }[] } | undefined) {
  if (!message) return "";
  if (typeof message.content === "string") return message.content;
  return message.content.map((b) => (b.type === "text" ? b.text : "")).join("");
}

function askThenReport(questions: JsonValue = QUESTIONS) {
  return (context: PiContext) => {
    const index = context.messages.findLastIndex((m: { role: string }) => m.role === "toolResult");
    if (index >= 0) {
      return fauxAssistantMessage([fauxText(`RESULT:${textOf(context.messages[index])}`)]);
    }
    const args: JsonObject = { questions };
    return {
      ...fauxAssistantMessage([fauxToolCall("ask_owner", args)]),
      stopReason: "toolUse" as const,
    };
  };
}

function reduce(events: ChatEvent[]): ChatState | undefined {
  let state: ChatState | undefined;
  for (const event of events) {
    if (event.type === "snapshot") state = structuredClone(event.state);
    else if (state && event.type === "upsert") {
      const i = state.messages.findIndex((m) => m.id === event.message.id);
      if (i >= 0) state.messages[i] = event.message;
      else state.messages.push(event.message);
    } else if (state && event.type === "remove") {
      state.messages = state.messages.filter((m) => m.id !== event.id);
    } else if (state && event.type === "busy") state.busy = event.busy;
  }
  return state;
}

function waitingCall(events: ChatEvent[]) {
  return until(() => {
    const call = reduce(events)
      ?.messages.flatMap((m) => m.toolCalls ?? [])
      .findLast((call) => call.name === "ask_owner");
    return call?.status === "awaiting_answer" ? call : undefined;
  }, "awaiting_answer");
}

function finalText(events: ChatEvent[]): string | undefined {
  const state = reduce(events);
  if (!state || state.busy) return undefined;
  return state.messages.find((m) => m.text.startsWith("RESULT:"))?.text.slice(7);
}

const runtimes: AgentRuntime[] = [];
afterEach(async () => {
  await Promise.allSettled(runtimes.splice(0).map((runtime) => runtime.close()));
});

async function open(respondWith = askThenReport()) {
  const runtime = await openTestRuntime({
    storePath: ":memory:",
    capabilities: undefined,
    respondWith,
  });
  runtimes.push(runtime);
  return runtime;
}

async function start(runtime: AgentRuntime) {
  const ref = await runtime.createConversation({
    modelId: TEST_MODEL,
    systemPrompt: "",
    capabilities: { enabled: ["questions"], permissions: {} },
  });
  const events: ChatEvent[] = [];
  await runtime.watchChat(ref, (batch) => {
    events.push(...batch);
  });
  await runtime.submit(ref, { requestId: "r1", text: "set up the project" });
  return { ref, events };
}

describe("guest answers reach the model attributed", () => {
  it("frames a guest's answers as the guest's, not the owner's", async () => {
    const runtime = await open();
    const { ref, events } = await start(runtime);
    const waiting = (await waitingCall(events)) as ChatToolCall;
    await runtime.answerQuestions(ref, waiting.taskId!, [{ selected: ["Postgres"] }], {
      answeredBy: "Priya (guest)",
    });
    const text = await until(() => finalText(events), "reply");
    expect(text).toContain("Priya (guest) answered your questions");
    expect(text).not.toMatch(/^The owner answered/m);
    expect(text).toMatch(/A: Postgres/);
  }, 15_000);

  it("still frames the owner's answers as the owner's", async () => {
    const runtime = await open();
    const { ref, events } = await start(runtime);
    const waiting = (await waitingCall(events)) as ChatToolCall;
    await runtime.answerQuestions(ref, waiting.taskId!, [{ selected: ["Postgres"] }]);
    const text = await until(() => finalText(events), "reply");
    expect(text).toContain("The owner answered your questions");
    expect(text).toMatch(/A: Postgres/);
  }, 15_000);
});
