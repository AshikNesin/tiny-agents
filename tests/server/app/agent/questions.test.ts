import { mkdtemp, rm } from "node:fs/promises";
import { until } from "../../fixtures/until";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "typebox";
import {
  type Context as PiContext,
  type JsonObject,
  type JsonValue,
  type Message,
} from "@earendil-works/pi-ai";
import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { afterEach, describe, expect, it } from "vite-plus/test";
import type { Capability } from "../../../../packages/agent/src/capabilities";
import { QuestionNotPendingError, type AgentRuntime } from "../../../../packages/agent/src/runtime";
import {
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  openTestRuntime,
  TEST_MODEL,
} from "../../../../packages/agent/src/testing";
import { InvalidAnswersError } from "../../../../packages/agent/src/toolkits/questions";
import type {
  ActivityChange,
  ChatEvent,
  ChatState,
  ChatToolCall,
  WaitEvent,
} from "../../../../packages/agent/src/types";

const QUESTIONS: JsonValue = [
  {
    question: " Which database? ",
    options: [{ label: " Postgres " }, { label: "Postgres" }, { label: "SQLite" }],
  },
  {
    question: "Which features?",
    description: "Pick any",
    options: [{ label: "Auth" }, { label: "Billing", description: "Stripe" }, { label: "Search" }],
    multiple: true,
  },
  { question: "Anything else?" },
];

function textOf(message: Message | undefined): string {
  if (!message) return "";
  if (typeof message.content === "string") return message.content;
  return message.content.map((b) => (b.type === "text" ? b.text : "")).join("");
}

function askThenReport(questions: JsonValue = QUESTIONS, tool = "ask_owner") {
  return (context: PiContext) => {
    const index = context.messages.findLastIndex((m) => m.role === "toolResult");
    if (index >= 0) {
      const then = context.messages.slice(index + 1).findLast((m) => m.role === "user");
      const reply = `RESULT:${textOf(context.messages[index])}${then ? `|THEN:${textOf(then)}` : ""}`;
      return fauxAssistantMessage([fauxText(reply)]);
    }
    const args: JsonObject = tool === "ask_owner" ? { questions } : { to: "ana@x.dev" };
    return { ...fauxAssistantMessage([fauxToolCall(tool, args)]), stopReason: "toolUse" as const };
  };
}

function mailCapability(sent: string[]): Capability {
  const sendEmail = defineTool({
    name: "send_email",
    description: "Send an email",
    parameters: Type.Object({ to: Type.String() }),
    execute: async (args) => {
      sent.push(args.to);
      return { output: [{ type: "text", text: `Sent to ${args.to}` }] };
    },
  });
  return {
    id: "mail",
    kind: "toolkit",
    name: "Mail",
    description: "Email",
    extension: defineExtension({ name: "mail", tools: [sendEmail] }),
    tools: [{ name: "send_email", label: "Sent email", description: "Send an email" }],
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

function toolCall(events: ChatEvent[], name = "ask_owner"): ChatToolCall | undefined {
  return reduce(events)
    ?.messages.flatMap((m) => m.toolCalls ?? [])
    .findLast((call) => call.name === name);
}

function waitingCall(events: ChatEvent[], status = "awaiting_answer") {
  return until(() => {
    const call = toolCall(events, status === "awaiting_answer" ? "ask_owner" : "send_email");
    return call?.status === status ? call : undefined;
  }, status);
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

async function open(
  respondWith = askThenReport(),
  options: { storePath?: string; capabilities?: Capability[] } = {},
) {
  const runtime = await openTestRuntime({
    storePath: options.storePath ?? ":memory:",
    capabilities: options.capabilities,
    respondWith,
  });
  runtimes.push(runtime);
  return runtime;
}

async function start(runtime: AgentRuntime, enabled = ["questions"]) {
  const ref = await runtime.createConversation({
    modelId: TEST_MODEL,
    systemPrompt: "",
    capabilities: { enabled, permissions: {} },
  });
  const events: ChatEvent[] = [];
  await runtime.watchChat(ref, (batch) => {
    events.push(...batch);
  });
  await runtime.submit(ref, { requestId: "r1", text: "set up the project" });
  return { ref, events };
}

describe("ask_owner", () => {
  it("is a read-only tool of the runtime's own questions capability", async () => {
    const runtime = await open();
    expect(runtime.listCapabilities()).toContainEqual(
      expect.objectContaining({
        id: "questions",
        tools: [
          expect.objectContaining({ name: "ask_owner", readOnly: true }),
          expect.objectContaining({ name: "message_owner", readOnly: true }),
        ],
      }),
    );
  });

  it("waits for the owner's answers and hands them to the model", async () => {
    const runtime = await open();
    const activity: ActivityChange[] = [];
    runtime.onActivity((change) => activity.push(change));
    const { ref, events } = await start(runtime);

    const waiting = await waitingCall(events);
    expect(waiting.taskId).toEqual(expect.any(Number));
    expect(waiting.questions).toEqual([
      { question: "Which database?", options: [{ label: "Postgres" }, { label: "SQLite" }] },
      {
        question: "Which features?",
        description: "Pick any",
        options: [
          { label: "Auth" },
          { label: "Billing", description: "Stripe" },
          { label: "Search" },
        ],
        multiple: true,
      },
      { question: "Anything else?" },
    ]);
    expect(runtime.pendingQuestions(ref)).toBe(1);
    expect(activity).toContainEqual({ conversation: ref, busy: true, approvals: 0, questions: 1 });

    await runtime.answerQuestions(ref, waiting.taskId!, [
      { selected: ["Postgres"] },
      { selected: ["Auth", "Billing"], text: " CSV export " },
      { selected: [] },
    ]);
    expect(await until(() => finalText(events), "reply")).toBe(
      [
        "The owner answered your questions:",
        "",
        "Q: Which database?\nA: Postgres",
        "",
        "Q: Which features?\nA: Auth; Billing; Other: CSV export",
        "",
        "Q: Anything else?\nA: (skipped)",
      ].join("\n"),
    );
    expect(toolCall(events)).toMatchObject({
      status: "done",
      questions: expect.any(Array),
      answers: [
        { selected: ["Postgres"] },
        { selected: ["Auth", "Billing"], text: "CSV export" },
        { selected: [] },
      ],
    });
    expect(runtime.pendingQuestions(ref)).toBe(0);
    await expect(runtime.answerQuestions(ref, waiting.taskId!, null)).rejects.toThrow(
      QuestionNotPendingError,
    );
  }, 15_000);

  it("a dismissal tells the model to go on without answers", async () => {
    const runtime = await open();
    const { ref, events } = await start(runtime);
    const waiting = await waitingCall(events);
    await runtime.answerQuestions(ref, waiting.taskId!, null);
    expect(await until(() => finalText(events), "reply")).toMatch(/dismissed these questions/);
    const call = toolCall(events);
    expect(call).toMatchObject({ status: "done", questions: expect.any(Array) });
    expect(call?.answers).toBeUndefined();
  }, 15_000);

  it("is not offered in an unattended conversation, where nobody can answer (issue #360)", async () => {
    const offered: string[][] = [];
    const runtime = await open((context: PiContext) => {
      const names = context.messages.flatMap((message) =>
        message.role === "system"
          ? ((message as { toolsAdded?: { name: string }[] }).toolsAdded ?? []).map((t) => t.name)
          : [],
      );
      offered.push(names);
      return fauxAssistantMessage([fauxText("done")]);
    });
    const ref = await runtime.createConversation({
      modelId: TEST_MODEL,
      systemPrompt: "",
      capabilities: { enabled: ["questions"], permissions: {}, unattended: true },
    });
    await runtime.submit(ref, { requestId: "r1", text: "set up the project" });
    await until(() => offered.length > 0, "request");
    expect(offered[0]).toContain("message_owner");
    expect(offered[0]).not.toContain("ask_owner");
  }, 15_000);

  it("rejects answers that do not fit the questions and keeps waiting", async () => {
    const runtime = await open();
    const { ref, events } = await start(runtime);
    const { taskId } = await waitingCall(events);
    const answer = (answers: { selected: string[]; text?: string }[]) =>
      runtime.answerQuestions(ref, taskId!, answers);

    await expect(answer([{ selected: ["Postgres"] }])).rejects.toThrow(/Expected 3 answer/);
    await expect(
      answer([{ selected: ["MySQL"] }, { selected: [] }, { selected: [] }]),
    ).rejects.toThrow(InvalidAnswersError);
    await expect(
      answer([{ selected: ["Postgres", "SQLite"] }, { selected: [] }, { selected: [] }]),
    ).rejects.toThrow(/takes one option/);
    await expect(
      answer([{ selected: [] }, { selected: [] }, { selected: ["Yes"] }]),
    ).rejects.toThrow(/not an option of question 3/);
    expect(runtime.pendingQuestions(ref)).toBe(1);

    await answer([{ selected: ["SQLite"] }, { selected: [] }, { selected: [], text: "no" }]);
    expect(await until(() => finalText(events), "reply")).toMatch(/A: SQLite[\s\S]*A: no$/);
  }, 15_000);

  it("refuses to answer a tool call that asked no questions", async () => {
    const sent: string[] = [];
    const runtime = await open(askThenReport(QUESTIONS, "send_email"), {
      capabilities: [mailCapability(sent)],
    });
    const { ref, events } = await start(runtime, ["mail", "questions"]);
    const waiting = await waitingCall(events, "awaiting_approval");
    await expect(runtime.answerQuestions(ref, waiting.taskId!, null)).rejects.toThrow(
      QuestionNotPendingError,
    );
    await runtime.decideApproval(ref, waiting.taskId!, "approved");
    expect(await until(() => finalText(events), "reply")).toBe("Sent to ana@x.dev");
    expect(sent).toEqual(["ana@x.dev"]);
  }, 15_000);

  it("reports each waiting call through onWait, with its tool and no arguments", async () => {
    const sent: string[] = [];
    const runtime = await open(askThenReport(QUESTIONS, "send_email"), {
      capabilities: [mailCapability(sent)],
    });
    const waits: WaitEvent[] = [];
    runtime.onWait((event) => waits.push(event));
    const { ref, events } = await start(runtime, ["mail", "questions"]);
    const waiting = await waitingCall(events, "awaiting_approval");
    expect(waits).toEqual([
      {
        kind: "approval",
        change: "added",
        conversation: ref,
        task: waiting.taskId,
        tool: "send_email",
      },
    ]);
    await runtime.decideApproval(ref, waiting.taskId!, "approved");
    await until(() => waits.length === 2, "removed");
    expect(waits[1]).toEqual({
      kind: "approval",
      change: "removed",
      conversation: ref,
      task: waiting.taskId,
    });

    const asker = await open();
    const questions: WaitEvent[] = [];
    asker.onWait((event) => questions.push(event));
    const second = await start(asker);
    const asked = await waitingCall(second.events);
    expect(questions).toEqual([
      {
        kind: "question",
        change: "added",
        conversation: second.ref,
        task: asked.taskId,
        tool: "ask_owner",
        preview: "Which database?",
      },
    ]);
  }, 15_000);

  it("stopping the reply ends the wait", async () => {
    const runtime = await open();
    const { ref, events } = await start(runtime);
    await waitingCall(events);
    await runtime.abort(ref);
    await until(() => reduce(events)?.busy === false, "run end");
    await until(() => runtime.pendingQuestions(ref) === 0, "wait released");
    expect(toolCall(events)?.status).toBe("aborted");
  }, 15_000);

  it("a message from the owner dismisses the questions and joins the reply", async () => {
    const runtime = await open();
    const { ref, events } = await start(runtime);
    await waitingCall(events);
    await runtime.submit(ref, { requestId: "r2", text: "Use SQLite", whenBusy: "steer" });
    await runtime.dismissQuestions(ref);
    expect(await until(() => finalText(events), "reply")).toMatch(
      /dismissed these questions[\s\S]*\|THEN:Use SQLite$/,
    );
    expect(runtime.pendingQuestions(ref)).toBe(0);
  }, 15_000);

  it("a message the owner sent before the questions came up dismisses them", async () => {
    const runtime = await open();
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
    await runtime.submit(ref, { requestId: "r2", text: "Use SQLite", whenBusy: "steer" });
    expect(await until(() => finalText(events), "reply")).toMatch(
      /dismissed these questions[\s\S]*\|THEN:Use SQLite$/,
    );
    expect(runtime.pendingQuestions(ref)).toBe(0);
  }, 15_000);
});

describe("ask_owner across restarts", () => {
  let directory: string;
  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("pending questions survive a restart and are answered after it", async () => {
    directory = await mkdtemp(join(tmpdir(), "tiny-agents-questions-"));
    const storePath = join(directory, "agent.db");

    const first = await open(askThenReport(), { storePath });
    const { ref, events } = await start(first);
    await waitingCall(events);
    await first.close();
    runtimes.splice(runtimes.indexOf(first), 1);

    const second = await open(askThenReport(), { storePath });
    const after: ChatEvent[] = [];
    await second.watchChat(ref, (batch) => {
      after.push(...batch);
    });
    const waiting = await waitingCall(after);
    await until(() => second.pendingQuestions(ref) === 1, "wait re-registered");
    await second.answerQuestions(ref, waiting.taskId!, [
      { selected: ["Postgres"] },
      { selected: ["Search"] },
      { selected: [] },
    ]);
    expect(await until(() => finalText(after), "reply")).toMatch(/A: Postgres[\s\S]*A: Search/);
  }, 30_000);
});
