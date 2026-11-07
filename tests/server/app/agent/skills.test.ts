/**
 * The `skills` capability (issue #1 D5–D7): the prompt lists only the bot's
 * skills, `load_skill` returns the instructions on demand, and `save_skill`
 * always waits for the owner's approval.
 */
import type { Context as PiContext } from "@earendil-works/pi-ai";
import { until } from "../../fixtures/until";
import { afterEach, describe, expect, it } from "vite-plus/test";
import type { AgentRuntime } from "../../../../packages/agent/src/runtime";
import { createSkillsCapability, type SkillStore } from "../../../../packages/agent/src/skills";
import {
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  openTestRuntime,
  TEST_MODEL,
} from "../../../../packages/agent/src/testing";
import type { ChatEvent, ChatState } from "../../../../packages/agent/src/types";

function memorySkills() {
  const byConversation = new Map<number, Map<string, { description: string; body: string }>>();
  const saved: string[] = [];
  const store: SkillStore = {
    async list(conversation) {
      return [...(byConversation.get(conversation) ?? new Map()).entries()].map(([name, s]) => ({
        name,
        description: s.description,
      }));
    },
    async get(conversation, name) {
      const skill = byConversation.get(conversation)?.get(name);
      return skill ? { name, ...skill, files: ["reference.md"] } : undefined;
    },
    async readFile(conversation, name, path) {
      return byConversation.get(conversation)?.has(name) && path === "reference.md"
        ? "REFERENCE"
        : undefined;
    },
    async save(conversation, skill) {
      saved.push(skill.name);
      const skills = byConversation.get(conversation) ?? new Map();
      const created = !skills.has(skill.name);
      skills.set(skill.name, { description: skill.description, body: skill.body });
      byConversation.set(conversation, skills);
      return { created };
    },
  };
  return { store, byConversation, saved };
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

describe("skills capability", () => {
  it("lists the bot's skills in the prompt and loads one on demand", async () => {
    const { store, byConversation } = memorySkills();
    const prompts: string[] = [];
    const runtime = await openTestRuntime({
      storePath: ":memory:",
      capabilities: [createSkillsCapability(store)],
      respondWith: (context: PiContext) => {
        // Sections reach the model as system context (pi-durable `pi.system` entries).
        prompts.push(JSON.stringify(context));
        const last = context.messages.at(-1);
        if (last?.role === "toolResult") {
          const text = Array.isArray(last.content)
            ? last.content.map((b) => (b.type === "text" ? b.text : "")).join("")
            : "";
          return fauxAssistantMessage([fauxText(`RESULT:${text}`)]);
        }
        return {
          ...fauxAssistantMessage([fauxToolCall("load_skill", { name: "weekly-report" })]),
          stopReason: "toolUse" as const,
        };
      },
    });
    runtimes.push(runtime);
    const ref = await runtime.createConversation({
      modelId: TEST_MODEL,
      systemPrompt: "You are helpful.",
      capabilities: { enabled: ["skills"], permissions: {} },
    });
    byConversation.set(
      ref,
      new Map([["weekly-report", { description: "Write the weekly report", body: "STEP 1" }]]),
    );
    const events: ChatEvent[] = [];
    await runtime.watchChat(ref, (batch) => events.push(...batch));
    await runtime.submit(ref, { requestId: "r1", text: "weekly report please" });
    const reply = await until(() => {
      const state = reduce(events);
      return !state?.busy && state?.messages.find((m) => m.text.startsWith("RESULT:"))?.text;
    }, "reply");
    expect(prompts[0]).toContain("- weekly-report: Write the weekly report");
    expect(reply).toContain("STEP 1");
    expect(reply).toContain("reference.md");
    expect(reduce(events)?.messages.flatMap((m) => m.toolCalls ?? [])[0]).toMatchObject({
      name: "load_skill",
      status: "done",
    });
  }, 15_000);

  it("save_skill always asks, even when set to allow", async () => {
    const { store, saved } = memorySkills();
    const runtime = await openTestRuntime({
      storePath: ":memory:",
      capabilities: [createSkillsCapability(store)],
      respondWith: (context: PiContext) =>
        context.messages.at(-1)?.role === "toolResult"
          ? fauxAssistantMessage([fauxText("done")])
          : {
              ...fauxAssistantMessage([
                fauxToolCall("save_skill", {
                  name: "triage-inbox",
                  description: "Triage the inbox",
                  body: "1. Read",
                }),
              ]),
              stopReason: "toolUse" as const,
            },
    });
    runtimes.push(runtime);
    const ref = await runtime.createConversation({
      modelId: TEST_MODEL,
      systemPrompt: "",
      capabilities: { enabled: ["skills"], permissions: { save_skill: "allow" } },
    });
    const events: ChatEvent[] = [];
    await runtime.watchChat(ref, (batch) => events.push(...batch));
    await runtime.submit(ref, { requestId: "r1", text: "remember how I triage" });
    const call = await until(
      () =>
        reduce(events)
          ?.messages.flatMap((m) => m.toolCalls ?? [])
          .find((c) => c.status === "awaiting_approval"),
      "approval",
    );
    expect(saved).toEqual([]);
    await runtime.decideApproval(ref, call.taskId!, "approved");
    await until(() => saved.length === 1, "save");
    expect(saved).toEqual(["triage-inbox"]);
  }, 15_000);
});
