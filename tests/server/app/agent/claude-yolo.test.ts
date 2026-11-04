/**
 * YOLO mode on the Claude plan engine (issue #151): its in-memory gate runs
 * `ask` calls without the card while YOLO is on, except tools flagged
 * `vault` and turns that are not the owner's. No worker, no network.
 */
import { describe, expect, it } from "vite-plus/test";
import { createClaudeApprovalGate } from "../../../../packages/agent/src/engines/claude-code/approvals";
import { ClaudeCodeEngine } from "../../../../packages/agent/src/engines/claude-code/engine";
import type { ChatMessage } from "../../../../packages/agent/src/types";

describe("Claude approval gate with YOLO", () => {
  it("runs an ask call YOLO accepts without asking, and labels it", async () => {
    const asked: string[] = [];
    const ran: { name: string; approval?: string }[] = [];
    const gate = createClaudeApprovalGate({
      permission: () => "ask",
      nextTaskId: () => 2_000_000_001,
      yolo: (name) => name !== "browser_fill_secret",
      onAsk: (call) => {
        asked.push(call.name);
        gate.decide(call.taskId, "approved");
      },
      execute: async (call, approval) => {
        ran.push({ name: call.name, ...(approval ? { approval } : {}) });
        return { content: "ok" };
      },
    });
    const call = (name: string) => ({ toolUseId: name, name, input: {}, turnId: "t" });
    await gate.run(call("web_search"));
    await gate.run(call("browser_fill_secret"));
    expect(asked).toEqual(["browser_fill_secret"]);
    expect(ran).toEqual([
      { name: "web_search", approval: "yolo" },
      { name: "browser_fill_secret", approval: "approved" },
    ]);
  });

  it("lists the calls waiting, for YOLO to approve them", async () => {
    let taskId = 2_000_000_000;
    const gate = createClaudeApprovalGate({
      permission: () => "ask",
      nextTaskId: () => ++taskId,
      onAsk: () => undefined,
      execute: async () => ({ content: "ok" }),
    });
    const running = gate.run({ toolUseId: "a", name: "send_email", input: {}, turnId: "t" });
    expect(gate.waiting()).toEqual([{ taskId: 2_000_000_001, name: "send_email" }]);
    gate.decide(2_000_000_001, "approved");
    await expect(running).resolves.toEqual({ content: "ok" });
    expect(gate.waiting()).toEqual([]);
  });
});

/** The engine's private parts a test drives: a turn's user message and a tool call. */
interface EngineInternals {
  sessions: Map<number, { messages: ChatMessage[] }>;
  onTool(call: {
    sessionId: string;
    turnId: string;
    toolUseId: string;
    name: string;
    input: unknown;
  }): Promise<{ content: string; isError?: boolean }>;
}

function engineWith(executed: string[]) {
  const engine = new ClaudeCodeEngine({
    env: () => ({}),
    execute: async (_ref, call) => {
      executed.push(call.name);
      return { content: "done" };
    },
  });
  engine.sync(5, {
    model: "claude-sonnet-4-6",
    system: "",
    tools: [],
    permissions: { send_email: "ask", http_request: "ask" },
    vaultTools: ["http_request"],
  });
  const internals = engine as unknown as EngineInternals;
  const say = (message: Partial<ChatMessage>) =>
    internals.sessions.get(5)!.messages.push({
      id: `u-${Math.random()}`,
      role: "user",
      text: "do it",
      status: "done",
      createdAt: Date.now(),
      ...message,
    });
  const tool = (name: string) =>
    internals.onTool({ sessionId: "5", turnId: "t1", toolUseId: name, name, input: {} });
  return { engine, say, tool };
}

describe("Claude plan engine with YOLO", () => {
  it("runs the owner's ask calls, but never a vault tool's", async () => {
    const executed: string[] = [];
    const { engine, say, tool } = engineWith(executed);
    say({});
    engine.setYolo(5, { on: true, by: 1 });
    await tool("send_email");
    expect(executed).toEqual(["send_email"]);
    void tool("http_request");
    await Promise.resolve();
    expect(executed).toEqual(["send_email"]);
  });

  it("asks in a turn another bot or a guest started", async () => {
    const executed: string[] = [];
    const { engine, say, tool } = engineWith(executed);
    engine.setYolo(5, { on: true, by: 1 });
    say({ peer: { kind: "message", name: "Scout" } });
    void tool("send_email");
    say({ author: { id: 9, name: "Gus" } });
    void tool("send_email");
    await Promise.resolve();
    expect(executed).toEqual([]);
    say({ author: { id: 1, name: "Ash" } });
    await tool("send_email");
    expect(executed).toEqual(["send_email"]);
  });

  it("switching on approves the waiting calls it would have run", async () => {
    const executed: string[] = [];
    const { engine, say, tool } = engineWith(executed);
    say({});
    const email = tool("send_email");
    void tool("http_request");
    await Promise.resolve();
    expect(executed).toEqual([]);
    const approved = engine.setYolo(5, { on: true, by: 1 });
    expect(approved).toHaveLength(1);
    await email;
    expect(executed).toEqual(["send_email"]);
  });

  it("never creates a session for a conversation that is not on the Claude plan", () => {
    const engine = new ClaudeCodeEngine({
      env: () => ({}),
      execute: async () => ({ content: "" }),
    });
    expect(engine.setYolo(42, { on: true })).toEqual([]);
    expect(engine.handles(42)).toBe(false);
  });
});
