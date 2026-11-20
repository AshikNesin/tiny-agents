import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { ModelUnavailableError, type AgentRuntime } from "../../../packages/agent/src/runtime";
import { submitToBot } from "../../../apps/web/src/server/api/bots/bots.conversation";
import { db, models, providers } from "../../../apps/web/src/server/db";
import { engineModelConfig, openEngine } from "../app/agent/engine-harness";
import { resetAppTables, seedBot, until } from "../fixtures";

const runtimes: AgentRuntime[] = [];
afterEach(async () => {
  await Promise.allSettled(runtimes.splice(0).map((runtime) => runtime.close()));
  await resetAppTables();
  await db.delete(providers).where(eq(providers.id, "c5-claude"));
});

async function seedClaudeModelRow(modelId: string): Promise<void> {
  await db.insert(providers).values({ id: "c5-claude", name: "Claude plan", kind: "claude-plan" });
  await db.insert(models).values({
    id: modelId,
    providerId: "c5-claude",
    upstreamId: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    source: "manual",
    contextWindow: 200_000,
    maxOutputTokens: 16_384,
    imageInput: false,
    reasoning: false,
  });
}

describe("C5: the Claude plan account switched off, with a fallback model set", () => {
  it("fails the app's send at configure; only a bare runtime submit reaches the gateway fallback", async () => {
    const engine = await openEngine("claude-code", {
      modelConfig: engineModelConfig({ fallback: true }),
    });
    const { runtime, worker, modelId } = engine;
    runtimes.push(runtime);
    const config = { modelId, systemPrompt: "Be brief." };
    const ref = await runtime.createConversation(config);
    await seedClaudeModelRow(modelId);
    const bot = await seedBot({ name: "Planner", modelId, conversationId: String(ref) });

    runtime.applyModelConfig(engineModelConfig({ enabled: false, fallback: true }));
    expect(runtime.catalog.claudePlan()).toEqual({ enabled: false, fallbackModelId: "test-model" });

    const refused = await runtime.configure(ref, config).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(ModelUnavailableError);
    expect(refused).toMatchObject({ modelId, reason: "disabled" });
    const sent = await submitToBot(bot.id, { requestId: "c5-app", text: "from the app" }, runtime)
      .then(() => "submitted")
      .catch((error: unknown) => error);
    expect(sent).toBeInstanceOf(ModelUnavailableError);
    expect((sent as Error).message).toBe(
      `Model "${modelId}" can't run right now (disabled). Check Settings → Models.`,
    );
    expect((await runtime.readChat(ref)).messages).toEqual([]);
    await expect(runtime.createConversation(config)).rejects.toBeInstanceOf(ModelUnavailableError);

    await runtime.submit(ref, { requestId: "c5-bare", text: "bare submit" });
    const state = await until(async () => {
      const read = await runtime.readChat(ref);
      return !read.busy && read.messages.at(-1)?.text === "Echo: bare submit" ? read : undefined;
    }, "the gateway reply");
    expect(state.messages.map((m) => m.requestId ?? m.role)).toEqual(["c5-bare", "assistant"]);
    expect(worker.turns).toEqual([]);
  }, 15_000);
});
