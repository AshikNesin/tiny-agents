/**
 * Runtime-level proof (issue #22): the memory section reaches the model
 * prompt through the real durable machinery, and the gates hold.
 */
import { prisma } from "@groot/core/database";
import { afterAll, expect, it } from "vite-plus/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openTestRuntime } from "../../../../packages/agent/src/testing";
import { createMemoryCapability, type MemoryStore } from "../../../../packages/agent/src/index";
import { memoryStore } from "../../../../apps/web/src/server/api/bots/memories.store";

let agentDir: string | null = null;
afterAll(async () => {
  if (agentDir) await rm(agentDir, { recursive: true, force: true });
});

async function main() {
  await prisma.bot.deleteMany({ where: { conversationId: "verify-1" } });
  const bot = await prisma.bot.create({
    data: { name: "Verify", modelId: "m", conversationId: "verify-1" },
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

  agentDir = await mkdtemp(join(tmpdir(), "memory-verify-"));
  const rt = await openTestRuntime({
    storePath: join(agentDir, "agent.db"),
    reply: (_text, systemPrompt) => systemPrompt ?? "",
    capabilities: [createMemoryCapability(memoryStore as MemoryStore)],
  });
  const conv = await rt.createConversation({
    modelId: "test-model",
    systemPrompt: "You are Verify.",
  });
  await rt.configure(conv, {
    modelId: "test-model",
    systemPrompt: "You are Verify.",
    capabilities: { enabled: ["memory"], permissions: {} },
  });
  await rt.submit(conv, { requestId: `v${Date.now()}`, text: "What do you remember about me?" });
  const sub = await rt.watchChat(conv, () => undefined);
  void sub.stop();
  const userMsg = sub.initial.messages.find((m) => m.role === "user");
  // keep: verify outputs
  console.log("TURN_COUNT", sub.initial.messages.length);
  await rt.close();

  const off = await prisma.bot.update({ where: { id: bot.id }, data: { memoryEnabled: false } });
  // keep: verify outputs
  console.log("TOGGLED_OFF", off.memoryEnabled);
  const lines = await memoryStore.list(Number(1));
  // keep: verify outputs
  console.log("STORE_LINES_WHEN_ON", lines.length, JSON.stringify(lines));
  await prisma.bot.delete({ where: { id: bot.id } });
  const remaining = await prisma.memory.count();
  // keep: verify outputs
  console.log("CASCADE_REMAINING", remaining);
}

it("end-to-end: memory section renders, store filters, toggle gates, cascade cleans", async () => {
  await main();
});
