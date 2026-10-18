/**
 * Remote MCP servers as capabilities (issue #1 M3), against an in-memory MCP
 * server: tool listing with annotations, list_changed, calls through a bot's
 * durable conversation, and the default permissions annotations imply.
 */
import type { Context as PiContext } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { z } from "zod";
import {
  connectMcp,
  createMcpCapability,
  MCP_DEFER_THRESHOLD,
  mcpToolName,
  type McpConnection,
  type McpToolInfo,
} from "../../../../packages/agent/src/mcp";
import type { AgentRuntime } from "../../../../packages/agent/src/runtime";
import {
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  InMemoryTransport,
  McpServer,
  openTestRuntime,
  TEST_MODEL,
} from "../../../../packages/agent/src/testing";
import type { ChatEvent, ChatState } from "../../../../packages/agent/src/types";

function demoServer() {
  const server = new McpServer({ name: "demo", version: "1.0.0" });
  const created: string[] = [];
  server.registerTool(
    "search_issues",
    {
      title: "Search issues",
      description: "Search issues",
      inputSchema: { query: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ query }) => ({ content: [{ type: "text", text: `found 2 for ${query}` }] }),
  );
  server.registerTool(
    "create_issue",
    { description: "Create an issue", inputSchema: { title: z.string() } },
    async ({ title }) => {
      created.push(title);
      return { content: [{ type: "text", text: `created ${title}` }] };
    },
  );
  return { server, created };
}

async function connectInMemory(server: McpServer, onToolsChanged?: (tools: McpToolInfo[]) => void) {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  return connectMcp({
    url: "https://mcp.example.test/mcp",
    transport: "streamable-http",
    createTransport: () => clientSide,
    onToolsChanged,
  });
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

async function until<T>(read: () => T | undefined | false, what: string): Promise<T> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  await Promise.allSettled(cleanup.splice(0).map((fn) => fn()));
});

describe("MCP connections", () => {
  it("lists tools with annotations and follows list_changed", async () => {
    const { server } = demoServer();
    let changed: McpToolInfo[] | undefined;
    const connection = await connectInMemory(server, (tools) => (changed = tools));
    cleanup.push(() => connection.close());
    expect(connection.tools).toEqual([
      expect.objectContaining({ name: "search_issues", title: "Search issues", readOnly: true }),
      expect.objectContaining({ name: "create_issue", description: "Create an issue" }),
    ]);

    server.registerTool("close_issue", { inputSchema: { id: z.string() } }, async () => ({
      content: [{ type: "text", text: "closed" }],
    }));
    await until(() => changed?.some((t) => t.name === "close_issue"), "list_changed");
  });

  it("calls tools through a bot conversation; read-only runs, writes ask", async () => {
    const { server, created } = demoServer();
    const connection: McpConnection = await connectInMemory(server);
    cleanup.push(() => connection.close());
    const capability = createMcpCapability({
      slug: "demo",
      name: "Demo",
      url: "https://mcp.example.test/mcp",
      tools: connection.tools,
      call: connection.call,
    });
    expect(capability.id).toBe("mcp:demo");
    expect(capability.tools.map((t) => [t.name, t.readOnly ?? false])).toEqual([
      ["mcp__demo__search_issues", true],
      ["mcp__demo__create_issue", false],
    ]);

    const plan = [
      fauxToolCall(mcpToolName("demo", "search_issues"), { query: "sse" }),
      fauxToolCall(mcpToolName("demo", "create_issue"), { title: "Fix SSE" }),
    ];
    const runtime: AgentRuntime = await openTestRuntime({
      storePath: ":memory:",
      capabilities: [capability],
      respondWith: (context: PiContext) => {
        const results = context.messages.filter((m) => m.role === "toolResult").length;
        const next = plan[results];
        return next
          ? { ...fauxAssistantMessage([next]), stopReason: "toolUse" as const }
          : fauxAssistantMessage([fauxText("RESULT:done")]);
      },
    });
    cleanup.push(() => runtime.close());
    const ref = await runtime.createConversation({
      modelId: TEST_MODEL,
      systemPrompt: "",
      capabilities: { enabled: ["mcp:demo"], permissions: {} },
    });
    const events: ChatEvent[] = [];
    await runtime.watchChat(ref, (batch) => events.push(...batch));
    await runtime.submit(ref, { requestId: "r1", text: "file it" });

    const waiting = await until(
      () =>
        reduce(events)
          ?.messages.flatMap((m) => m.toolCalls ?? [])
          .find((c) => c.status === "awaiting_approval"),
      "approval for create_issue",
    );
    expect(waiting.name).toBe("mcp__demo__create_issue");
    const calls = reduce(events)!.messages.flatMap((m) => m.toolCalls ?? []);
    expect(calls[0]).toMatchObject({ status: "done", output: "found 2 for sse" });
    expect(created).toEqual([]);

    await runtime.decideApproval(ref, waiting.taskId!, "approved");
    await until(() => {
      const state = reduce(events);
      return !state?.busy && state?.messages.some((m) => m.text === "RESULT:done");
    }, "reply");
    expect(created).toEqual(["Fix SSE"]);
  }, 20_000);

  it("names tools within provider limits", () => {
    expect(mcpToolName("linear", "create.issue")).toBe("mcp__linear__create_issue");
    expect(mcpToolName("x", "a".repeat(80))).toHaveLength(64);
  });

  it("defers the tools of large servers behind tool_search", () => {
    const many = Array.from({ length: MCP_DEFER_THRESHOLD + 1 }, (_, i) => ({
      name: `tool_${i}`,
      inputSchema: { type: "object" },
    }));
    const capability = createMcpCapability({
      slug: "big",
      name: "Big",
      url: "https://big.example.test/mcp",
      tools: many,
      call: async () => ({ content: [] }),
    });
    expect(capability.extension.tools?.every((tool) => tool.deferred === true)).toBe(true);
    const small = createMcpCapability({
      slug: "small",
      name: "Small",
      url: "https://small.example.test/mcp",
      tools: many.slice(0, 5),
      call: async () => ({ content: [] }),
    });
    expect(small.extension.tools?.every((tool) => tool.deferred === undefined)).toBe(true);
  });
});
