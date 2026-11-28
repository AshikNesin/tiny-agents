import type { Context as PiContext } from "@earendil-works/pi-ai";
import { until } from "../../fixtures/until";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { z } from "zod";
import { defaultPermission } from "../../../../packages/agent/src/wire";
import {
  connectMcp,
  createMcpCapability,
  MCP_LIST_PAGES_MAX,
  MCP_LIST_TOOLS_MAX,
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
  ListToolsRequestSchema,
  McpServer,
  openTestRuntime,
  Server,
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

function toolPage(n: number) {
  return {
    name: `tool_${n}`,
    inputSchema: { type: "object" as const },
  };
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

  it("stops listing a server whose pages never end, keeping the tools it found", async () => {
    const server = new Server(
      { name: "endless", version: "1.0.0" },
      { capabilities: { tools: {} } },
    );
    let pages = 0;
    server.setRequestHandler(ListToolsRequestSchema, async (request) => {
      pages += 1;
      const n = Number(request.params?.cursor ?? 0);
      return { nextCursor: String(n + 1), tools: [toolPage(n)] };
    });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const connection = await connectMcp({
      url: "https://endless.example.test/mcp",
      transport: "streamable-http",
      createTransport: () => clientSide,
    });
    cleanup.push(() => connection.close());
    expect(pages).toBe(MCP_LIST_PAGES_MAX);
    expect(connection.tools.map((t) => t.name)).toEqual(
      Array.from({ length: MCP_LIST_PAGES_MAX }, (_, i) => `tool_${i}`),
    );
  });

  it("stops listing a server that floods its pages, keeping the first tools", async () => {
    const server = new Server({ name: "flood", version: "1.0.0" }, { capabilities: { tools: {} } });
    let pages = 0;
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      pages += 1;
      return {
        nextCursor: "more",
        tools: Array.from({ length: 300 }, (_, i) => toolPage(pages * 1000 + i)),
      };
    });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const connection = await connectMcp({
      url: "https://flood.example.test/mcp",
      transport: "streamable-http",
      createTransport: () => clientSide,
    });
    cleanup.push(() => connection.close());
    expect(pages).toBe(2);
    expect(connection.tools).toHaveLength(MCP_LIST_TOOLS_MAX);
    expect(connection.tools[299]).toMatchObject({ name: "tool_1299" });
    expect(connection.tools[300]).toMatchObject({ name: "tool_2000" });
    expect(connection.tools.at(-1)).toMatchObject({ name: "tool_2199" });
  });

  it("calls tools through a bot conversation; a server's read-only hint still asks", async () => {
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
      ["mcp__demo__search_issues", false],
      ["mcp__demo__create_issue", false],
    ]);
    expect(capability.extension.tools?.map((t) => t.replay)).toEqual(["unsafe", "unsafe"]);
    expect(capability.tools.map((t) => defaultPermission(t))).toEqual(["ask", "ask"]);

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
    await runtime.watchChat(ref, (batch) => {
      events.push(...batch);
    });
    await runtime.submit(ref, { requestId: "r1", text: "file it" });

    const waiting = await until(
      () =>
        reduce(events)
          ?.messages.flatMap((m) => m.toolCalls ?? [])
          .find((c) => c.status === "awaiting_approval"),
      "approval for search_issues",
    );
    expect(waiting.name).toBe("mcp__demo__search_issues");
    expect(created).toEqual([]);

    await runtime.decideApproval(ref, waiting.taskId!, "approved");
    const second = await until(
      () =>
        reduce(events)
          ?.messages.flatMap((m) => m.toolCalls ?? [])
          .find((c) => c.name === "mcp__demo__create_issue" && c.status === "awaiting_approval"),
      "approval for create_issue",
    );
    await runtime.decideApproval(ref, second.taskId!, "approved");
    await until(() => {
      const state = reduce(events);
      return !state?.busy && state?.messages.some((m) => m.text === "RESULT:done");
    }, "reply");
    const calls = reduce(events)!.messages.flatMap((m) => m.toolCalls ?? []);
    expect(calls[0]).toMatchObject({ status: "done", output: "found 2 for sse" });
    expect(calls[1]).toMatchObject({ status: "done", output: "created Fix SSE" });
    expect(created).toEqual(["Fix SSE"]);
  }, 20_000);

  it("runs an MCP tool without asking only when the owner allowed it by name", async () => {
    const { server, created } = demoServer();
    const connection: McpConnection = await connectInMemory(server);
    cleanup.push(() => connection.close());
    const runtime: AgentRuntime = await openTestRuntime({
      storePath: ":memory:",
      capabilities: [
        createMcpCapability({
          slug: "demo",
          name: "Demo",
          url: "https://mcp.example.test/mcp",
          tools: connection.tools,
          call: connection.call,
        }),
      ],
      respondWith: (context: PiContext) => {
        const results = context.messages.filter((m) => m.role === "toolResult").length;
        const calls = [
          fauxToolCall(mcpToolName("demo", "create_issue"), { title: "Fix SSE" }),
          fauxToolCall(mcpToolName("demo", "search_issues"), { query: "sse" }),
        ];
        const next = calls[results];
        return next
          ? { ...fauxAssistantMessage([next]), stopReason: "toolUse" as const }
          : fauxAssistantMessage([fauxText("RESULT:done")]);
      },
    });
    cleanup.push(() => runtime.close());
    const ref = await runtime.createConversation({
      modelId: TEST_MODEL,
      systemPrompt: "",
      capabilities: {
        enabled: ["mcp:demo"],
        permissions: { [mcpToolName("demo", "create_issue")]: "allow" },
      },
    });
    const events: ChatEvent[] = [];
    await runtime.watchChat(ref, (batch) => {
      events.push(...batch);
    });
    await runtime.submit(ref, { requestId: "r1", text: "file it" });

    const waiting = await until(
      () =>
        reduce(events)
          ?.messages.flatMap((m) => m.toolCalls ?? [])
          .find((c) => c.status === "awaiting_approval"),
      "approval for search_issues",
    );
    expect(waiting.name).toBe("mcp__demo__search_issues");
    expect(created).toEqual(["Fix SSE"]);
    await runtime.decideApproval(ref, waiting.taskId!, "approved");
    await until(() => {
      const state = reduce(events);
      return !state?.busy && state?.messages.some((m) => m.text === "RESULT:done");
    }, "reply");
    const calls = reduce(events)!.messages.flatMap((m) => m.toolCalls ?? []);
    expect(calls[0]).toMatchObject({ name: "mcp__demo__create_issue", status: "done" });
    expect(calls[0]?.approval).toBeUndefined();
    expect(calls[1]).toMatchObject({ name: "mcp__demo__search_issues", approval: "approved" });
  }, 20_000);

  it("keeps a server's hints out of the gated tool info", () => {
    const capability = createMcpCapability({
      slug: "demo",
      name: "Demo",
      url: "https://mcp.example.test/mcp",
      tools: [
        {
          name: "search_issues",
          description: "Search issues",
          inputSchema: {},
          readOnly: true,
          idempotent: true,
        },
      ],
      call: async () => ({ content: [] }),
    });
    expect(capability.tools[0]).toEqual({
      name: "mcp__demo__search_issues",
      label: "search_issues",
      description: "Search issues",
    });
    expect(capability.extension.tools?.[0]?.replay).toBe("unsafe");
  });

  it("names tools within provider limits", () => {
    expect(mcpToolName("linear", "search_issues")).toBe("mcp__linear__search_issues");
    expect(mcpToolName("x", "a".repeat(80))).toHaveLength(64);
    expect(mcpToolName("linear", "create.issue")).toMatch(
      /^mcp__linear__create_issue_[0-9a-z]{7}$/,
    );
  });

  it("gives two tools whose names cut to the same 64 characters distinct names", () => {
    const first = mcpToolName("linear", "search_issues_in_project_" + "a".repeat(40));
    const second = mcpToolName("linear", "search_issues_in_project_" + "b".repeat(40));
    expect(first).toHaveLength(64);
    expect(second).toHaveLength(64);
    expect(first).not.toBe(second);
    expect(first.startsWith("mcp__linear__search_issues_in_project_")).toBe(true);
    expect(mcpToolName("linear", "search_issues_in_project_" + "a".repeat(40))).toBe(first);

    const aliased = mcpToolName("x", "a.b".repeat(17));
    const dotted = mcpToolName("x", "a_b".repeat(17));
    expect(aliased).not.toBe(dotted);
  });

  it("never gives two tools in one connection the same name", () => {
    const names = Array.from({ length: 6 }, (_, i) => "run_check_" + String(i).repeat(60));
    const capability = createMcpCapability({
      slug: "ci",
      name: "CI",
      url: "https://ci.example.test/mcp",
      tools: names.map((name) => ({ name, inputSchema: {} })),
      call: async () => ({ content: [] }),
    });
    const resolved = capability.tools.map((t) => t.name);
    expect(new Set(resolved).size).toBe(names.length);
    expect(capability.extension.tools?.map((t) => t.name)).toEqual(resolved);
    expect(resolved.every((name) => name.length <= 64)).toBe(true);
  });

  it("cuts a server's long tool descriptions to 2,048 characters", () => {
    const capability = createMcpCapability({
      slug: "wordy",
      name: "Wordy",
      url: "https://wordy.example.test/mcp",
      tools: [
        { name: "search", description: "Find things. " + "x".repeat(5_000), inputSchema: {} },
        { name: "list", description: "List things.", inputSchema: {} },
      ],
      call: async () => ({ content: [] }),
    });
    const [search, list] = capability.extension.tools ?? [];
    expect(search?.description).toHaveLength(2_048);
    expect(search?.description.startsWith("Find things. xxx")).toBe(true);
    expect(search?.description.endsWith("…")).toBe(true);
    expect(list?.description).toBe("List things.");
  });

  it("defers a server's tools by the size of their schemas, not their count", () => {
    const capability = (slug: string, tools: McpToolInfo[]) =>
      createMcpCapability({
        slug,
        name: slug,
        url: `https://${slug}.example.test/mcp`,
        tools,
        call: async () => ({ content: [] }),
      });
    const heavy = Array.from({ length: 3 }, (_, i) => ({
      name: `heavy_${i}`,
      inputSchema: {
        type: "object",
        properties: { q: { type: "string", description: "x".repeat(3_000) } },
      },
    }));
    const big = capability("big", heavy);
    expect(big.extension.tools?.every((tool) => tool.deferred === true)).toBe(true);
    const light = Array.from({ length: 40 }, (_, i) => ({
      name: `tool_${i}`,
      inputSchema: { type: "object" },
    }));
    const small = capability("small", light);
    expect(small.extension.tools?.every((tool) => tool.deferred === undefined)).toBe(true);
  });
});
