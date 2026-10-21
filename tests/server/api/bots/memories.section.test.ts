/**
 * Runtime-level proof (issue #22): the memory section reaches the model's
 * prompt through the real durable machinery. pi-durable renders extension
 * sections onto the system message's `sections` map (not `systemPrompt`), so
 * the proof captures that message — the exact surface the provider reads.
 * The bot row is keyed to the conversation the runtime created, so the store
 * lookup the capability performs actually finds it.
 */
import { prisma } from "@groot/core/database";
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
import { memoryStore } from "../../../../apps/web/src/server/api/bots/memories.store";
import type { ChatMessage } from "../../../../packages/agent/src/types";

let agentDir: string | null = null;
afterAll(async () => {
  if (agentDir) await rm(agentDir, { recursive: true, force: true });
});

async function until<T>(read: () => T | undefined | false): Promise<T> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() >= deadline) throw new Error("Timed out waiting for memory tool");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

it(
  "remember asks before saving, then injects the saved fact into a fresh chat",
  { timeout: 15_000 },
  async () => {
    const text = "The owner prefers TypeScript, never JavaScript.";
    const capability = createMemoryCapability(memoryStore);
    expect(capability.tools).toContainEqual({
      name: "remember",
      label: "Saved memory",
      description: "Remember a fact about the owner",
    });
    const rt = await openTestRuntime({
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
      const bot = await prisma.bot.create({
        data: { name: "Memory writer", modelId: "test-model", conversationId: String(conv) },
      });
      botId = bot.id;
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
      const call = await until(() =>
        [...messages.values()]
          .flatMap((m) => m.toolCalls ?? [])
          .find((tool) => tool.status === "awaiting_approval"),
      );
      expect(await prisma.memory.count({ where: { botId } })).toBe(0);
      await rt.decideApproval(conv, call.taskId!, "approved");
      await until(() =>
        [...messages.values()].find(
          (m) => m.role === "assistant" && m.text.length > 0 && m.status === "done",
        ),
      );
      expect(await memoryStore.list(conv)).toMatchObject([{ text }]);
      await first.stop();

      const fresh = await rt.createConversation(config);
      await prisma.bot.update({ where: { id: botId }, data: { conversationId: String(fresh) } });
      const next = await watch(fresh);
      await rt.submit(fresh, { requestId: "recall", text: "What do you know about me?" });
      const reply = await until(() =>
        [...messages.values()].find((m) => m.role === "assistant" && m.status === "done"),
      );
      expect(reply.text).toContain(text);
      await next.stop();
    } finally {
      await rt.close();
      if (botId) await prisma.bot.delete({ where: { id: botId } });
    }
  },
);

function systemSections(context: Context): Record<string, string> {
  const system = context.messages.find((m) => m.role === "system") as
    | { sections?: Record<string, string> }
    | undefined;
  return system?.sections ?? {};
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
  await prisma.bot.deleteMany({ where: { conversationId } });

  const bot = await prisma.bot.create({
    data: { name: "Verify", modelId: "m", conversationId },
  });
  await prisma.memory.create({
    data: {
      botId: bot.id,
      text: "Prefers pnpm over npm",
      category: "preference",
      status: "active",
      source: "manual",
    },
  });
  await prisma.memory.create({
    data: {
      botId: bot.id,
      text: "Deleted fact",
      category: "fact",
      status: "deleted",
      source: "manual",
    },
  });
  await prisma.memory.create({
    data: {
      botId: bot.id,
      text: "Expired fact",
      category: "fact",
      status: "active",
      source: "manual",
      until: new Date("2020-01-01"),
    },
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
  await prisma.bot.update({ where: { id: bot.id }, data: { memoryEnabled: false } });
  const afterToggle = await memoryStore.list(Number(conversationId));
  expect(afterToggle).toEqual([]);

  await rt.close();
  await prisma.bot.delete({ where: { id: bot.id } });
  await expect(prisma.memory.count({ where: { botId: bot.id } })).resolves.toBe(0);
});
