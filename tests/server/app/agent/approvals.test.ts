import { mkdtemp, rm } from "node:fs/promises";
import { until } from "../../fixtures/until";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type, type Context as PiContext, type JsonObject } from "@earendil-works/pi-ai";
import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { approvalOf, approvalWaitInfo } from "../../../../packages/agent/src/approvals";
import type { Capability } from "../../../../packages/agent/src/capabilities";
import { ApprovalNotPendingError, type AgentRuntime } from "../../../../packages/agent/src/runtime";
import {
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  openTestRuntime,
  TEST_MODEL,
} from "../../../../packages/agent/src/testing";
import type {
  ActivityChange,
  ChatEvent,
  ChatState,
  ChatToolCall,
} from "../../../../packages/agent/src/types";

interface Mailer {
  sent: string[];
  hold?: Promise<void>;
}

function mailCapability(mailer: Mailer): Capability {
  const sendEmail = defineTool({
    name: "send_email",
    description: "Send an email",
    parameters: Type.Object({ to: Type.String() }),
    execute: async (args) => {
      mailer.sent.push(args.to);
      if (mailer.hold) {
        await mailer.hold;
        throw new Error("process died mid-call");
      }
      return { output: [{ type: "text", text: `Sent to ${args.to}` }] };
    },
  });
  const readInbox = defineTool({
    name: "read_inbox",
    description: "Read the inbox",
    parameters: Type.Object({}),
    replay: "safe",
    execute: async () => ({ output: [{ type: "text", text: "2 unread" }] }),
  });
  return {
    id: "mail",
    kind: "toolkit",
    name: "Mail",
    description: "Email",
    extension: defineExtension({ name: "mail", tools: [sendEmail, readInbox] }),
    tools: [
      { name: "send_email", label: "Sent email", description: "Send an email" },
      { name: "read_inbox", label: "Read inbox", description: "Read", readOnly: true },
    ],
  };
}

function callThenReport(tool: string, args: JsonObject) {
  return (context: PiContext) => {
    const last = context.messages.at(-1);
    if (last?.role === "toolResult") {
      const text = Array.isArray(last.content)
        ? last.content.map((b) => (b.type === "text" ? b.text : "")).join("")
        : "";
      return fauxAssistantMessage([fauxText(`RESULT:${text}`)]);
    }
    const message = fauxAssistantMessage([fauxToolCall(tool, args)]);
    return { ...message, stopReason: "toolUse" as const };
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

function toolCall(events: ChatEvent[], name: string): ChatToolCall | undefined {
  return reduce(events)
    ?.messages.flatMap((m) => m.toolCalls ?? [])
    .findLast((call) => call.name === name);
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
  mailer: Mailer,
  respondWith: ReturnType<typeof callThenReport>,
  storePath = ":memory:",
) {
  const runtime = await openTestRuntime({
    storePath,
    capabilities: [mailCapability(mailer)],
    respondWith,
  });
  runtimes.push(runtime);
  return runtime;
}

describe("capabilities and approvals", () => {
  it("lists installed capabilities without their extensions", async () => {
    const runtime = await open({ sent: [] }, callThenReport("read_inbox", {}));
    expect(runtime.listCapabilities()).toEqual([
      expect.objectContaining({ id: "mail", kind: "toolkit", name: "Mail" }),
      expect.objectContaining({ id: "questions", kind: "toolkit" }),
      expect.objectContaining({ id: "tool-search", kind: "toolkit", auto: true }),
    ]);
    expect(runtime.listCapabilities()[0]).not.toHaveProperty("extension");
  });

  it("runs read-only tools without asking (default allow)", async () => {
    const runtime = await open({ sent: [] }, callThenReport("read_inbox", {}));
    const ref = await runtime.createConversation({
      modelId: TEST_MODEL,
      systemPrompt: "",
      capabilities: { enabled: ["mail"], permissions: {} },
    });
    const events: ChatEvent[] = [];
    await runtime.watchChat(ref, (batch) => {
      events.push(...batch);
    });
    await runtime.submit(ref, { requestId: "r1", text: "check mail" });
    expect(await until(() => finalText(events), "reply")).toBe("2 unread");
    expect(toolCall(events, "read_inbox")).toMatchObject({ status: "done", output: "2 unread" });
  }, 15_000);

  it("waits for approval, then runs the tool once (default ask)", async () => {
    const mailer: Mailer = { sent: [] };
    const runtime = await open(mailer, callThenReport("send_email", { to: "ana@x.dev" }));
    const activity: ActivityChange[] = [];
    runtime.onActivity((change) => activity.push(change));
    const ref = await runtime.createConversation({
      modelId: TEST_MODEL,
      systemPrompt: "",
      capabilities: { enabled: ["mail"], permissions: {} },
    });
    const events: ChatEvent[] = [];
    await runtime.watchChat(ref, (batch) => {
      events.push(...batch);
    });
    await runtime.submit(ref, { requestId: "r1", text: "email ana" });

    const waiting = await until(
      () =>
        toolCall(events, "send_email")?.status === "awaiting_approval"
          ? toolCall(events, "send_email")
          : undefined,
      "approval card",
    );
    expect(waiting.taskId).toEqual(expect.any(Number));
    expect(mailer.sent).toEqual([]);
    expect(runtime.pendingApprovals(ref)).toBe(1);
    expect(activity).toContainEqual({ conversation: ref, busy: true, approvals: 1, questions: 0 });

    await runtime.decideApproval(ref, waiting.taskId!, "approved");
    expect(await until(() => finalText(events), "reply")).toBe("Sent to ana@x.dev");
    expect(mailer.sent).toEqual(["ana@x.dev"]);
    expect(toolCall(events, "send_email")).toMatchObject({ status: "done", approval: "approved" });
    expect(runtime.pendingApprovals(ref)).toBe(0);
    await expect(runtime.decideApproval(ref, waiting.taskId!, "approved")).rejects.toThrow(
      /not waiting/,
    );
  }, 15_000);

  it("reports the wait for approval apart from the tool's own run time (issue #86)", async () => {
    const mailer: Mailer = { sent: [] };
    const runtime = await open(mailer, callThenReport("send_email", { to: "ana@x.dev" }));
    const ref = await runtime.createConversation({
      modelId: TEST_MODEL,
      systemPrompt: "",
      capabilities: { enabled: ["mail"], permissions: {} },
    });
    const events: ChatEvent[] = [];
    await runtime.watchChat(ref, (batch) => {
      events.push(...batch);
    });
    await runtime.submit(ref, { requestId: "r1", text: "email ana" });
    const waiting = await until(
      () =>
        toolCall(events, "send_email")?.status === "awaiting_approval"
          ? toolCall(events, "send_email")
          : undefined,
      "approval card",
    );
    vi.setSystemTime(Date.now() + 400);
    await runtime.decideApproval(ref, waiting.taskId!, "approved");
    await until(() => finalText(events), "reply");

    const done = toolCall(events, "send_email")!;
    expect(done.waitedMs).toBe(400);
    expect(done.durationMs).toBeLessThan(done.waitedMs!);
  }, 15_000);

  it("a denied call never runs and tells the model", async () => {
    const mailer: Mailer = { sent: [] };
    const runtime = await open(mailer, callThenReport("send_email", { to: "bo@x.dev" }));
    const ref = await runtime.createConversation({
      modelId: TEST_MODEL,
      systemPrompt: "",
      capabilities: { enabled: ["mail"], permissions: { send_email: "ask" } },
    });
    const events: ChatEvent[] = [];
    await runtime.watchChat(ref, (batch) => {
      events.push(...batch);
    });
    await runtime.submit(ref, { requestId: "r1", text: "email bo" });
    const waiting = await until(
      () =>
        toolCall(events, "send_email")?.status === "awaiting_approval"
          ? toolCall(events, "send_email")
          : undefined,
      "approval card",
    );
    await runtime.decideApproval(ref, waiting.taskId!, "denied");
    expect(await until(() => finalText(events), "reply")).toMatch(/denied/);
    expect(mailer.sent).toEqual([]);
    expect(toolCall(events, "send_email")).toMatchObject({ status: "denied", approval: "denied" });
  }, 15_000);

  it("refuses an `ask` call in an unattended conversation instead of waiting (issue #63)", async () => {
    const mailer: Mailer = { sent: [] };
    const runtime = await open(mailer, callThenReport("send_email", { to: "di@x.dev" }));
    const ref = await runtime.createConversation({
      modelId: TEST_MODEL,
      systemPrompt: "",
      capabilities: { enabled: ["mail"], permissions: {}, unattended: true },
    });
    const events: ChatEvent[] = [];
    await runtime.watchChat(ref, (batch) => {
      events.push(...batch);
    });
    await runtime.submit(ref, { requestId: "r1", text: "email di" });

    expect(await until(() => finalText(events), "reply")).toMatch(/needs the owner's approval/);
    expect(mailer.sent).toEqual([]);
    expect(runtime.pendingApprovals(ref)).toBe(0);
    expect(toolCall(events, "send_email")).toMatchObject({ status: "error", approval: "refused" });
    const replies = await runtime.finishedReplies(ref);
    expect(replies.flatMap((reply) => reply.refused ?? [])).toEqual(["send_email"]);
  }, 15_000);

  it("runs `allow` tools in an unattended conversation, and asks again once attended", async () => {
    const mailer: Mailer = { sent: [] };
    const runtime = await open(mailer, callThenReport("send_email", { to: "ed@x.dev" }));
    const ref = await runtime.createConversation({
      modelId: TEST_MODEL,
      systemPrompt: "",
      capabilities: { enabled: ["mail"], permissions: { send_email: "allow" }, unattended: true },
    });
    const events: ChatEvent[] = [];
    await runtime.watchChat(ref, (batch) => {
      events.push(...batch);
    });
    await runtime.submit(ref, { requestId: "r1", text: "email ed" });
    expect(await until(() => finalText(events), "reply")).toBe("Sent to ed@x.dev");
    expect((await runtime.finishedReplies(ref)).some((reply) => reply.refused)).toBe(false);

    await runtime.configure(ref, {
      modelId: TEST_MODEL,
      systemPrompt: "",
      capabilities: { enabled: ["mail"], permissions: {} },
    });
    await runtime.submit(ref, { requestId: "r2", text: "email ed again" });
    await until(
      () => toolCall(events, "send_email")?.status === "awaiting_approval" || undefined,
      "approval card",
    );
    expect(runtime.pendingApprovals(ref)).toBe(1);
  }, 15_000);

  it("runs `allow` tools unattended and hides `off` tools from the model", async () => {
    const mailer: Mailer = { sent: [] };
    const runtime = await open(mailer, callThenReport("send_email", { to: "cy@x.dev" }));
    const ref = await runtime.createConversation({
      modelId: TEST_MODEL,
      systemPrompt: "",
      capabilities: { enabled: ["mail"], permissions: { send_email: "allow" } },
    });
    const events: ChatEvent[] = [];
    await runtime.watchChat(ref, (batch) => {
      events.push(...batch);
    });
    await runtime.submit(ref, { requestId: "r1", text: "email cy" });
    expect(await until(() => finalText(events), "reply")).toBe("Sent to cy@x.dev");

    await runtime.configure(ref, {
      modelId: TEST_MODEL,
      systemPrompt: "",
      capabilities: { enabled: ["mail"], permissions: { send_email: "off" } },
    });
    events.length = 0;
    await runtime.watchChat(ref, (batch) => {
      events.push(...batch);
    });
    await runtime.submit(ref, { requestId: "r2", text: "again" });
    await until(() => {
      const state = reduce(events);
      return (
        state &&
        !state.busy &&
        state.messages.filter((m) => m.text.startsWith("RESULT:")).length === 2
      );
    }, "second reply");
    expect(mailer.sent).toEqual(["cy@x.dev"]);
    expect(toolCall(events, "send_email")).toMatchObject({ status: "error" });
  }, 20_000);

  it("a disabled capability's tools are not offered", async () => {
    const mailer: Mailer = { sent: [] };
    const runtime = await open(mailer, callThenReport("read_inbox", {}));
    const ref = await runtime.createConversation({
      modelId: TEST_MODEL,
      systemPrompt: "",
      capabilities: { enabled: [], permissions: {} },
    });
    const events: ChatEvent[] = [];
    await runtime.watchChat(ref, (batch) => {
      events.push(...batch);
    });
    await runtime.submit(ref, { requestId: "r1", text: "check" });
    await until(() => finalText(events) !== undefined || undefined, "reply");
    expect(toolCall(events, "read_inbox")?.status).toBe("error");
    expect(toolCall(events, "read_inbox")?.output).toMatch(/not available/);
  }, 15_000);
});

describe("decisions for calls that are not waiting", () => {
  it("refuses to decide a running call that never asked (an allowed tool mid-run)", async () => {
    let release!: () => void;
    const hold = new Promise<void>((resolve) => (release = resolve));
    const slow: Capability = {
      id: "slow",
      kind: "toolkit",
      name: "Slow",
      description: "",
      extension: defineExtension({
        name: "slow",
        tools: [
          defineTool({
            name: "slow_read",
            description: "Read slowly",
            parameters: Type.Object({}),
            replay: "safe",
            execute: async () => {
              await hold;
              return { output: [{ type: "text", text: "read" }] };
            },
          }),
        ],
      }),
      tools: [{ name: "slow_read", label: "Read slowly", description: "", readOnly: true }],
    };
    const runtime = await openTestRuntime({
      storePath: ":memory:",
      capabilities: [slow],
      respondWith: callThenReport("slow_read", {}),
    });
    runtimes.push(runtime);
    const ref = await runtime.createConversation({
      modelId: TEST_MODEL,
      systemPrompt: "",
      capabilities: { enabled: ["slow"], permissions: {} },
    });
    const events: ChatEvent[] = [];
    await runtime.watchChat(ref, (batch) => {
      events.push(...batch);
    });
    await runtime.submit(ref, { requestId: "r1", text: "read" });
    const running = await until(() => {
      const call = toolCall(events, "slow_read");
      return call?.status === "running" && call.taskId !== undefined ? call : undefined;
    }, "the call to run");
    await expect(runtime.decideApproval(ref, running.taskId!, "approved")).rejects.toThrow(
      ApprovalNotPendingError,
    );
    await expect(runtime.decideApproval(ref, running.taskId!, "denied")).rejects.toThrow(
      ApprovalNotPendingError,
    );
    release();
    expect(await until(() => finalText(events), "reply")).toBe("read");
    expect(toolCall(events, "slow_read")?.approval).toBeUndefined();
  }, 15_000);
});

describe("approvals across restarts", () => {
  let directory: string;
  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("a pending approval survives a restart and the tool runs once after it", async () => {
    directory = await mkdtemp(join(tmpdir(), "tiny-agents-approval-"));
    const storePath = join(directory, "agent.db");
    const mailer: Mailer = { sent: [] };
    const respond = callThenReport("send_email", { to: "di@x.dev" });

    const first = await open(mailer, respond, storePath);
    const ref = await first.createConversation({
      modelId: TEST_MODEL,
      systemPrompt: "",
      capabilities: { enabled: ["mail"], permissions: {} },
    });
    const events: ChatEvent[] = [];
    await first.watchChat(ref, (batch) => {
      events.push(...batch);
    });
    await first.submit(ref, { requestId: "r1", text: "email di" });
    await until(() => toolCall(events, "send_email")?.status === "awaiting_approval", "card");
    await first.close();
    runtimes.splice(runtimes.indexOf(first), 1);

    const second = await open(mailer, respond, storePath);
    const after: ChatEvent[] = [];
    await second.watchChat(ref, (batch) => {
      after.push(...batch);
    });
    const waiting = await until(
      () =>
        toolCall(after, "send_email")?.status === "awaiting_approval"
          ? toolCall(after, "send_email")
          : undefined,
      "card after restart",
    );
    await until(() => second.pendingApprovals(ref) === 1, "gate re-run");
    await second.decideApproval(ref, waiting.taskId!, "approved");
    expect(await until(() => finalText(after), "reply")).toBe("Sent to di@x.dev");
    expect(mailer.sent).toEqual(["di@x.dev"]);
  }, 30_000);

  it("an approved unsafe tool cut off mid-effect reports interrupted instead of running twice", async () => {
    directory = await mkdtemp(join(tmpdir(), "tiny-agents-approval-"));
    const storePath = join(directory, "agent.db");
    let release!: () => void;
    const mailer: Mailer = { sent: [], hold: new Promise<void>((r) => (release = r)) };
    const respond = callThenReport("send_email", { to: "ed@x.dev" });

    const first = await open(mailer, respond, storePath);
    const ref = await first.createConversation({
      modelId: TEST_MODEL,
      systemPrompt: "",
      capabilities: { enabled: ["mail"], permissions: {} },
    });
    const events: ChatEvent[] = [];
    await first.watchChat(ref, (batch) => {
      events.push(...batch);
    });
    await first.submit(ref, { requestId: "r1", text: "email ed" });
    const waiting = await until(
      () =>
        toolCall(events, "send_email")?.status === "awaiting_approval"
          ? toolCall(events, "send_email")
          : undefined,
      "card",
    );
    await first.decideApproval(ref, waiting.taskId!, "approved");
    await until(() => mailer.sent.length === 1, "effect");
    const closing = first.close();
    await new Promise((r) => setTimeout(r, 50));
    release();
    await closing;
    runtimes.splice(runtimes.indexOf(first), 1);

    mailer.hold = undefined;
    const second = await open(mailer, respond, storePath);
    const after: ChatEvent[] = [];
    await second.watchChat(ref, (batch) => {
      after.push(...batch);
    });
    expect(await until(() => finalText(after), "reply")).toMatch(/interrupted/);
    expect(mailer.sent).toEqual(["ed@x.dev"]);
    expect(toolCall(after, "send_email")).toMatchObject({ status: "interrupted" });
  }, 30_000);
});

describe("the pending card's vault details", () => {
  it("drops a vault card that does not fit, and logs the key", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const view = approvalOf({ approval: "pending", vault: { handle: "github", kind: "planet" } });
      expect(view).toEqual({ state: "pending" });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('details "vault" does not fit'));
    } finally {
      warn.mockRestore();
    }
  });
});

describe("what a waiting vault call tells the push", () => {
  it("names the item and host, and whether the card offers For this chat", () => {
    const plan = (grantable: boolean) => ({
      ask: true,
      details: {
        vault: { label: "GitHub login", target: "https://www.github.com/login", grantable },
      },
    });
    expect(approvalWaitInfo("browser_fill", plan(true))).toEqual({
      tool: "browser_fill",
      subject: "GitHub login on github.com",
      vault: { grantable: true },
    });
    expect(approvalWaitInfo("browser_fill", plan(false)).vault).toEqual({ grantable: false });
    expect(approvalWaitInfo("run_command", undefined)).toEqual({ tool: "run_command" });
  });
});
