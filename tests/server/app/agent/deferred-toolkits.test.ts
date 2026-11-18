/**
 * Deferred toolkits (issue #360, after pi's `deferred` exposure): a toolkit's
 * tools are not sent until the model loads them with `tool_search`, and a
 * stable prompt section names what can be loaded.
 */
import { Type, type Context as PiContext } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { until } from "../../fixtures/until";
import type { AgentRuntime } from "../../../../packages/agent/src/runtime";
import { createBrowserToolkit, createComputerToolkit } from "../../../../packages/agent/src/index";
import {
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  openTestRuntime,
  TEST_MODEL,
} from "../../../../packages/agent/src/testing";
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

// pi-durable declares tools in system messages; replay them as the provider sees them.
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
    // The section lists what can be loaded, so loading changes nothing in it.
    const shown = JSON.stringify(requests[2]!.messages);
    expect(shown.split("- desk (2 tools)")).toHaveLength(2);

    const results = requests[2]!.messages.filter((m) => m.role === "toolResult");
    expect(JSON.stringify(results.at(-1))).toContain("a pen");
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
      // The desk's tools are Off: nothing is left to load.
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

  it("defers the browser and the computer", () => {
    for (const toolkit of [
      createBrowserToolkit({ sessions: {} as never }),
      createComputerToolkit({ sessions: {} as never }),
    ]) {
      const tools = toolkit.extension.tools ?? [];
      expect(tools.length).toBeGreaterThan(0);
      expect(tools.every((t) => t.deferred === true)).toBe(true);
    }
  });
});
