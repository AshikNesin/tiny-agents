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
import { openTestRuntime } from "../../../../packages/agent/src/testing";
import { createMemoryCapability, type MemoryStore } from "../../../../packages/agent/src/index";
import { memoryStore } from "../../../../apps/web/src/server/api/bots/memories.store";

let agentDir: string | null = null;
afterAll(async () => {
  if (agentDir) await rm(agentDir, { recursive: true, force: true });
});

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
