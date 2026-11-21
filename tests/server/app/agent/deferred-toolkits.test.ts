import { Type, type Context as PiContext } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { until } from "../../fixtures/until";
import type { AgentRuntime } from "../../../../packages/agent/src/runtime";
import {
  createAttachmentsToolkit,
  createBotBuilderCapability,
  createBotsToolkit,
  createBrowserToolkit,
  createCodeToolkit,
  createComputerToolkit,
  createMemoryCapability,
  createRoutinesToolkit,
  createSandboxToolkit,
  createSelfImproveCapability,
  createSkillsCapability,
  createTasksToolkit,
  createVaultToolkit,
  createWebToolkit,
} from "../../../../packages/agent/src/index";
import {
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  openTestRuntime,
  TEST_MODEL,
} from "../../../../packages/agent/src/testing";
import { createMcpCapability } from "../../../../packages/agent/src/mcp";
import { createQuestionsCapability } from "../../../../packages/agent/src/toolkits/questions";
import { WaitTracker } from "../../../../packages/agent/src/waiting";
import { defineToolkit, tool } from "../../../../packages/agent/src/toolkit";

const ok = (text: string) => async () => ({ output: [{ type: "text" as const, text }] });

function deskToolkit() {
  return defineToolkit({
    id: "desk",
    name: "Desk",
    description: "Read and tidy the desk",
    deferred: true,
    tools: [
      tool({
        name: "desk_read",
        label: "Read the desk",
        askLabel: "read the desk",
        summary: "Read the desk",
        description: "Read what is on the desk.",
        policy: { readOnly: true },
        parameters: Type.Object({}),
        execute: ok("a pen"),
      }),
      tool({
        name: "desk_tidy",
        label: "Tidied the desk",
        askLabel: "tidy the desk",
        summary: "Tidy the desk",
        description: "Put the desk in order.",
        policy: { readOnly: true },
        parameters: Type.Object({}),
        execute: ok("tidy"),
      }),
    ],
  });
}

function notesToolkit() {
  return defineToolkit({
    id: "notes",
    name: "Notes",
    description: "Notes",
    tools: [
      tool({
        name: "note_add",
        label: "Added a note",
        askLabel: "add a note",
        summary: "Add a note",
        description: "Add a note.",
        policy: { readOnly: true },
        parameters: Type.Object({}),
        execute: ok("noted"),
      }),
    ],
  });
}

const offered = (context: PiContext) => {
  const names = new Set<string>();
  for (const message of context.messages as {
    role: string;
    toolsAdded?: { name: string }[];
    toolsRemoved?: { name: string }[];
  }[]) {
    if (message.role !== "system") continue;
    for (const tool of message.toolsRemoved ?? []) names.delete(tool.name);
    for (const tool of message.toolsAdded ?? []) names.add(tool.name);
  }
  return [...names].sort();
};

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0)) await fn();
});

describe("deferred toolkits", () => {
  it("sends a deferred toolkit's tools only after tool_search loads them, and names it in the prompt", async () => {
    const requests: PiContext[] = [];
    const plan = [
      fauxToolCall("tool_search", { query: "desk", limit: 2 }),
      fauxToolCall("desk_read", {}),
    ];
    const runtime: AgentRuntime = await openTestRuntime({
      storePath: ":memory:",
      capabilities: [deskToolkit(), notesToolkit()],
      respondWith: (context: PiContext) => {
        requests.push(structuredClone(context));
        const next = plan[context.messages.filter((m) => m.role === "toolResult").length];
        return next
          ? { ...fauxAssistantMessage([next]), stopReason: "toolUse" as const }
          : fauxAssistantMessage([fauxText("done")]);
      },
    });
    cleanup.push(() => runtime.close());
    const ref = await runtime.createConversation({
      modelId: TEST_MODEL,
      systemPrompt: "",
      capabilities: { enabled: ["desk", "notes", "tool-search"], permissions: {} },
    });
    await runtime.submit(ref, { requestId: "r1", text: "what is on the desk?" });
    await until(() => requests.length >= 3, "reply");

    expect(offered(requests[0]!)).toEqual(["note_add", "tool_search"]);
    expect(offered(requests[1]!)).toEqual(["desk_read", "desk_tidy", "note_add", "tool_search"]);

    const prompt = JSON.stringify(requests[0]!.messages);
    expect(prompt).toContain("- desk (2 tools): Desk. Read and tidy the desk");
    const shown = JSON.stringify(requests[2]!.messages);
    expect(shown.split("- desk (2 tools)")).toHaveLength(2);

    const results = requests[2]!.messages.filter((m) => m.role === "toolResult");
    expect(JSON.stringify(results.at(-1))).toContain("a pen");
  }, 20_000);

  it("lists a deferred connection's tool names in the prompt, so the model knows what to search for", async () => {
    const requests: PiContext[] = [];
    const schema = {
      type: "object",
      properties: { q: { type: "string", description: "x".repeat(5_000) } },
    };
    const issues = createMcpCapability({
      slug: "issues",
      name: "Issues",
      url: "https://issues.example.test/mcp",
      tools: [
        { name: "search_issues", description: "Search issues.", inputSchema: schema },
        { name: "create_issue", description: "Create an issue.", inputSchema: schema },
      ],
      call: async () => ({ content: [] }),
    });
    const runtime: AgentRuntime = await openTestRuntime({
      storePath: ":memory:",
      capabilities: [issues, notesToolkit()],
      respondWith: (context: PiContext) => {
        requests.push(structuredClone(context));
        return fauxAssistantMessage([fauxText("done")]);
      },
    });
    cleanup.push(() => runtime.close());
    const ref = await runtime.createConversation({
      modelId: TEST_MODEL,
      systemPrompt: "",
      capabilities: { enabled: ["mcp:issues", "notes", "tool-search"], permissions: {} },
    });
    await runtime.submit(ref, { requestId: "r1", text: "hi" });
    await until(() => requests.length >= 1, "reply");
    expect(offered(requests[0]!)).toEqual(["note_add", "tool_search"]);
    expect(JSON.stringify(requests[0]!.messages)).toContain(
      "- mcp:issues (2 tools): Issues, a connection. Tools (each named mcp__issues__<name>): search_issues, create_issue",
    );
  }, 20_000);

  it("lists at most 40 of a deferred connection's tool names, and counts the rest", async () => {
    const requests: PiContext[] = [];
    const many = createMcpCapability({
      slug: "many",
      name: "Many",
      url: "https://many.example.test/mcp",
      tools: Array.from({ length: 45 }, (_, i) => ({
        name: `tool_${i}`,
        description: "x".repeat(200),
        inputSchema: { type: "object" },
      })),
      call: async () => ({ content: [] }),
    });
    const runtime: AgentRuntime = await openTestRuntime({
      storePath: ":memory:",
      capabilities: [many],
      respondWith: (context: PiContext) => {
        requests.push(structuredClone(context));
        return fauxAssistantMessage([fauxText("done")]);
      },
    });
    cleanup.push(() => runtime.close());
    const ref = await runtime.createConversation({
      modelId: TEST_MODEL,
      systemPrompt: "",
      capabilities: { enabled: ["mcp:many", "tool-search"], permissions: {} },
    });
    await runtime.submit(ref, { requestId: "r1", text: "hi" });
    await until(() => requests.length >= 1, "reply");
    const prompt = JSON.stringify(requests[0]!.messages);
    expect(prompt).toContain("tool_38, tool_39, and 5 more");
    expect(prompt).not.toContain("tool_40");
  }, 20_000);

  it("offers no tool_search where nothing is deferred", async () => {
    const requests: PiContext[] = [];
    const runtime: AgentRuntime = await openTestRuntime({
      storePath: ":memory:",
      capabilities: [deskToolkit(), notesToolkit()],
      respondWith: (context: PiContext) => {
        requests.push(structuredClone(context));
        return fauxAssistantMessage([fauxText("done")]);
      },
    });
    cleanup.push(() => runtime.close());
    const ref = await runtime.createConversation({
      modelId: TEST_MODEL,
      systemPrompt: "",
      capabilities: {
        enabled: ["desk", "notes", "tool-search"],
        permissions: { desk_read: "off", desk_tidy: "off" },
      },
    });
    await runtime.submit(ref, { requestId: "r1", text: "hi" });
    await until(() => requests.length >= 1, "reply");
    expect(offered(requests[0]!)).toEqual(["note_add"]);
    expect(JSON.stringify(requests[0]!.messages)).not.toContain("deferred_tools");
  }, 20_000);

  it("defers the toolkits few conversations use and keeps the everyday ones direct", () => {
    const stub = {} as never;
    const deferred = [
      createBrowserToolkit({ sessions: stub }),
      createComputerToolkit({ sessions: stub }),
      createCodeToolkit({ store: stub }),
      createAttachmentsToolkit(stub),
      createBotBuilderCapability(stub),
      createSelfImproveCapability(stub),
      createVaultToolkit({ broker: stub }),
    ];
    for (const toolkit of deferred) {
      const tools = toolkit.extension.tools ?? [];
      expect(tools.length, toolkit.id).toBeGreaterThan(0);
      expect(
        tools.every((t) => t.deferred === true),
        toolkit.id,
      ).toBe(true);
    }
    const direct = [
      createTasksToolkit(stub),
      createRoutinesToolkit(stub),
      createWebToolkit({ apiKey: "key" }),
      createSandboxToolkit({ connection: stub }),
      createMemoryCapability(stub),
      createSkillsCapability(stub),
      createBotsToolkit(stub),
    ];
    for (const toolkit of direct) {
      expect(
        (toolkit.extension.tools ?? []).some((t) => t.deferred),
        toolkit.id,
      ).toBe(false);
    }
  });

  it("keeps the tools every request carries under 10,500 characters", () => {
    const stub = {} as never;
    const direct = [
      createTasksToolkit(stub),
      createRoutinesToolkit(stub),
      createWebToolkit({ apiKey: "key" }),
      createSandboxToolkit({ connection: stub }),
      createMemoryCapability(stub),
      createSkillsCapability(stub),
      createBotsToolkit(stub),
      createQuestionsCapability(new WaitTracker()),
    ];
    const size = direct
      .flatMap((toolkit) => toolkit.extension.tools ?? [])
      .reduce(
        (sum, t) =>
          sum +
          JSON.stringify({ name: t.name, description: t.description, input_schema: t.parameters })
            .length,
        0,
      );
    expect(size).toBeLessThan(10_500);
  });
});
