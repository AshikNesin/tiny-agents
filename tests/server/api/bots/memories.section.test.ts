/**
 * Runtime-level proof (issue #22): the memory section reaches the model's
 * prompt through the real durable machinery. pi-durable renders extension
 * sections onto the system message's `sections` map (not `systemPrompt`), so
 * the proof captures that message: the exact surface the provider reads.
 * The bot row is keyed to the conversation the runtime created, so the store
 * lookup the capability performs actually finds it.
 */
import { eq } from "drizzle-orm";
import { afterAll, expect, it } from "vite-plus/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context } from "@earendil-works/pi-ai";
import {
  openTestRuntime,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
} from "../../../../packages/agent/src/testing";
import { createMemoryCapability, type MemoryStore } from "../../../../packages/agent/src/index";
import {
  createMemoryStore,
  memoryStore,
} from "../../../../apps/web/src/server/api/bots/memories.store";
import type { AgentRuntime } from "../../../../packages/agent/src/runtime";
import type { ChatMessage } from "../../../../packages/agent/src/types";
import { bots, db, memories } from "../../../../apps/web/src/server/db";
import { until } from "../../fixtures";

let agentDir: string | null = null;
afterAll(async () => {
  if (agentDir) await rm(agentDir, { recursive: true, force: true });
});

it(
  "remember asks before saving, injects the fact into a fresh chat, and forget removes it",
  { timeout: 20_000 },
  async () => {
    const text = "The owner prefers TypeScript, never JavaScript.";
    // Chat writes read the turn's author from this runtime (isUnattended).
    let rt: AgentRuntime | undefined;
    const store = createMemoryStore(() => rt!);
    const capability = createMemoryCapability(store);
    expect(capability.tools).toContainEqual({
      name: "remember",
      label: "Saved memory",
      askLabel: "save a memory",
      description: "Remember a fact about the owner",
    });
    rt = await openTestRuntime({
      storePath: ":memory:",
      capabilities: [capability],
      respondWith: (context) => {
        const last = context.messages.at(-1);
        if (last?.role === "toolResult") return fauxAssistantMessage([fauxText("Stored.")]);
        if (JSON.stringify(last).includes("Remember my preference")) {
          return {
            ...fauxAssistantMessage([fauxToolCall("remember", { text, category: "preference" })]),
            stopReason: "toolUse",
          };
        }
        if (JSON.stringify(last).includes("Forget my TypeScript")) {
          return {
            ...fauxAssistantMessage([fauxToolCall("forget", { text: "TypeScript" })]),
            stopReason: "toolUse",
          };
        }
        return fauxAssistantMessage([fauxText(systemSections(context).memory ?? "No memories.")]);
      },
    });
    let botId: string | undefined;
    try {
      const config = {
        modelId: "test-model",
        systemPrompt: "",
        capabilities: { enabled: ["memory"], permissions: {} },
      };
      const conv = await rt.createConversation(config);
      const [bot] = await db
        .insert(bots)
        .values({ name: "Memory writer", modelId: "test-model", conversationId: String(conv) })
        .returning();
      botId = bot!.id;
      const messages = new Map<string, ChatMessage>();
      const watch = async (id: number) => {
        messages.clear();
        return rt.watchChat(id, (events) => {
          for (const event of events) {
            if (event.type === "snapshot") {
              messages.clear();
              for (const message of event.state.messages) messages.set(message.id, message);
            } else if (event.type === "upsert") {
              messages.set(event.message.id, event.message);
            }
          }
        });
      };
      const first = await watch(conv);
      await rt.submit(conv, {
        requestId: "remember",
        text: "Remember my preference for TypeScript.",
      });
      const call = await until(
        () =>
          [...messages.values()]
            .flatMap((m) => m.toolCalls ?? [])
            .find((tool) => tool.status === "awaiting_approval"),
        "the remember approval card",
      );
      expect(await db.$count(memories, eq(memories.botId, botId))).toBe(0);
      await rt.decideApproval(conv, call.taskId!, "approved");
      await until(
        () =>
          [...messages.values()].find(
            (m) => m.role === "assistant" && m.text.length > 0 && m.status === "done",
          ),
        "the reply after remembering",
      );
      expect(await memoryStore.list(conv)).toMatchObject([{ text }]);
      await first.stop();

      const fresh = await rt.createConversation(config);
      await db
        .update(bots)
        .set({ conversationId: String(fresh) })
        .where(eq(bots.id, botId));
      const next = await watch(fresh);
      await rt.submit(fresh, { requestId: "recall", text: "What do you know about me?" });
      const reply = await until(
        () => [...messages.values()].find((m) => m.role === "assistant" && m.status === "done"),
        "the recall reply",
      );
      expect(reply.text).toContain(text);

      // "Forget …" in chat: the tool asks, tombstones, and the fact leaves the prompt.
      await rt.submit(fresh, { requestId: "forget", text: "Forget my TypeScript preference." });
      const forgetCall = await until(
        () =>
          [...messages.values()]
            .flatMap((m) => m.toolCalls ?? [])
            .find((tool) => tool.name === "forget" && tool.status === "awaiting_approval"),
        "the forget approval card",
      );
      await rt.decideApproval(fresh, forgetCall.taskId!, "approved");
      const done = await until(
        () =>
          [...messages.values()]
            .flatMap((m) => m.toolCalls ?? [])
            .find((tool) => tool.name === "forget" && tool.status === "done"),
        "the forget call to finish",
      );
      expect(done.output).toContain(text);
      expect(await db.query.memories.findFirst({ where: eq(memories.botId, botId) })).toMatchObject(
        {
          status: "deleted",
        },
      );
      const before = messages.size;
      await rt.submit(fresh, { requestId: "recall-2", text: "And now?" });
      const after = await until(
        () =>
          [...messages.values()]
            .slice(before)
            .find((m) => m.role === "assistant" && m.status === "done"),
        "the reply after forgetting",
      );
      expect(after.text).toBe("No memories.");
      await next.stop();
    } finally {
      await rt.close();
      if (botId) await db.delete(bots).where(eq(bots.id, botId));
    }
  },
);

/**
 * The sections in effect for this request: pi-durable stores section changes
 * as positional system entries, so later entries override earlier ones and
 * `null` removes a section.
 */
function systemSections(context: Context): Record<string, string> {
  const effective: Record<string, string> = {};
  for (const message of context.messages) {
    if (message.role !== "system") continue;
    const sections = (message as { sections?: Record<string, string | null> }).sections ?? {};
    for (const [key, value] of Object.entries(sections)) {
      if (value === null) delete effective[key];
      else effective[key] = value;
    }
  }
  return effective;
}

it("memory section injects active memories and the gates hold", { timeout: 15_000 }, async () => {
  let captured: Record<string, string> | undefined;
  agentDir = await mkdtemp(join(tmpdir(), "memory-verify-"));
  const rt = await openTestRuntime({
    storePath: join(agentDir, "agent.db"),
    respondWith: (context) => {
      captured ??= systemSections(context);
      return { content: [{ type: "text", text: "ok" }] } as never;
    },
    capabilities: [createMemoryCapability(memoryStore as MemoryStore)],
  });
  const conv = await rt.createConversation({
    modelId: "test-model",
    systemPrompt: "You are Verify.",
  });
  const conversationId = String(conv);
  await db.delete(bots).where(eq(bots.conversationId, conversationId));

  const [bot] = await db
    .insert(bots)
    .values({ name: "Verify", modelId: "m", conversationId })
    .returning();
  await db.insert(memories).values({
    botId: bot!.id,
    text: "Prefers pnpm over npm",
    category: "preference",
    status: "active",
    source: "manual",
  });
  await db.insert(memories).values({
    botId: bot!.id,
    text: "Deleted fact",
    category: "fact",
    status: "deleted",
    source: "manual",
  });
  await db.insert(memories).values({
    botId: bot!.id,
    text: "Expired fact",
    category: "fact",
    status: "active",
    source: "manual",
    until: new Date("2020-01-01"),
  });

  await rt.configure(conv, {
    modelId: "test-model",
    systemPrompt: "You are Verify.",
    capabilities: { enabled: ["memory"], permissions: {} },
  });
  await rt.submit(conv, { requestId: `v${Date.now()}`, text: "What do you remember about me?" });
  for (let i = 0; i < 50 && !captured; i++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const memorySection = captured?.memory;
  expect(memorySection).toContain("Prefers pnpm over npm");
  expect(memorySection).not.toContain("Deleted fact");
  expect(memorySection).not.toContain("Expired fact");

  const beforeToggle = await memoryStore.list(Number(conversationId));
  expect(beforeToggle.map((l) => l.text)).toEqual(["Prefers pnpm over npm"]);
  await db.update(bots).set({ memoryEnabled: false }).where(eq(bots.id, bot!.id));
  const afterToggle = await memoryStore.list(Number(conversationId));
  expect(afterToggle).toEqual([]);

  await rt.close();
  await db.delete(bots).where(eq(bots.id, bot!.id));
  await expect(db.$count(memories, eq(memories.botId, bot!.id))).resolves.toBe(0);
});
