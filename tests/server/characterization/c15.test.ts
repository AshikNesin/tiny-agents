import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JsonObject } from "@earendil-works/pi-ai";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { Capability } from "../../../packages/agent/src/capabilities";
import {
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  openTestRuntime,
  TEST_MODEL,
} from "../../../packages/agent/src/testing";
import {
  createMemoryCapability,
  type MemoryStore,
} from "../../../packages/agent/src/toolkits/memory";
import { createRoutinesToolkit } from "../../../packages/agent/src/toolkits/routines";
import { createSelfImproveCapability } from "../../../packages/agent/src/toolkits/self-improve";
import { createInstructionsStore } from "../../../apps/web/src/server/api/bots/self-improve.store";
import { createRoutineStore } from "../../../apps/web/src/server/api/routines/routines.toolkit-store";
import { bots, db, promptRevisions, routineRuns, routines } from "../../../apps/web/src/server/db";
import { installFakeRuntime, resetAppTables, seedBot, until } from "../fixtures";
import { loaded } from "../fixtures/loaded-tools";

beforeEach(resetAppTables);
afterEach(resetAppTables);

function dieOnce() {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let armed = true;
  let effects = 0;
  return {
    release,
    effects: () => effects,
    async after(): Promise<void> {
      effects++;
      if (!armed) return;
      armed = false;
      await gate;
      throw new Error("process died mid-call");
    },
  };
}

async function interruptAndResume(options: {
  capability: () => Capability;
  tool: string;
  args: JsonObject;
  death: ReturnType<typeof dieOnce>;
  conversationId?: (ref: number) => Promise<void>;
  beforeResume?: () => void;
}): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "tiny-agents-c15-"));
  const storePath = join(directory, "agent.db");
  const capabilities = { enabled: [options.capability().id], permissions: {} };
  try {
    const first = await openTestRuntime({
      storePath,
      capabilities: [loaded(options.capability())],
      respondWith: () => ({
        ...fauxAssistantMessage([fauxToolCall(options.tool, options.args)]),
        stopReason: "toolUse" as const,
      }),
    });
    const ref = await first.createConversation({
      modelId: TEST_MODEL,
      systemPrompt: "",
      capabilities,
    });
    await options.conversationId?.(ref);
    await first.setYolo(ref, true);
    await first.submit(ref, { requestId: "r1", text: "do it" });
    await until(() => options.death.effects() > 0, `${options.tool} to apply its effect`);
    const closing = first.close();
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    options.death.release();
    await closing;
    options.beforeResume?.();

    const second = await openTestRuntime({
      storePath,
      capabilities: [loaded(options.capability())],
      respondWith: (context) => {
        const result = context.messages.findLast((m) => m.role === "toolResult");
        const text =
          result && Array.isArray(result.content)
            ? result.content.map((b) => (b.type === "text" ? b.text : "")).join("")
            : "";
        return fauxAssistantMessage([fauxText(`RESULT:${text}`)]);
      },
    });
    try {
      const reply = await until(async () => {
        const state = await second.readChat(ref);
        return state.busy
          ? undefined
          : state.messages.find((m) => m.text.startsWith("RESULT:"))?.text;
      }, "the resumed run to finish");
      return reply.slice("RESULT:".length);
    } finally {
      await second.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe("C15: interrupted tool calls on resume", () => {
  it("re-runs update_instructions: an append applies twice", { timeout: 30_000 }, async () => {
    const death = dieOnce();
    const real = createInstructionsStore(() => ({
      readChat: async () => ({ messages: [{ role: "user", text: "do it" }] }) as never,
    }));
    const capability = () =>
      createSelfImproveCapability({
        read: real.read,
        update: async (id, input) => {
          const result = await real.update(id, input);
          await death.after();
          return result;
        },
      });
    expect(capability().extension.tools?.[0]).toMatchObject({
      name: "update_instructions",
      replay: "safe",
    });

    let botId = "";
    const result = await interruptAndResume({
      capability,
      tool: "update_instructions",
      args: { append: "Sign off with a haiku." },
      death,
      conversationId: async (ref) => {
        botId = (await seedBot({ conversationId: String(ref), systemPrompt: "Be kind." })).id;
      },
    });
    expect(death.effects()).toBe(2);
    const bot = await db.query.bots.findFirst({ where: eq(bots.id, botId) });
    expect(bot?.systemPrompt).toBe("Be kind.\n\nSign off with a haiku.\n\nSign off with a haiku.");
    const revisions = await db.query.promptRevisions.findMany({
      where: eq(promptRevisions.botId, botId),
    });
    expect(revisions.map((r) => r.prompt)).toEqual([
      "Be kind.\n\nSign off with a haiku.",
      "Be kind.\n\nSign off with a haiku.\n\nSign off with a haiku.",
    ]);
    expect(result).toContain("Instructions updated.");
  });

  it(
    "re-runs run_routine_now: a second manual run is dispatched",
    { timeout: 30_000 },
    async () => {
      const app = installFakeRuntime();
      const death = dieOnce();
      const real = createRoutineStore();
      const capability = () =>
        createRoutinesToolkit({
          ...real,
          runNow: async (id, routineId) => {
            const run = await real.runNow(id, routineId);
            await death.after();
            return run;
          },
        });
      expect(
        capability().extension.tools?.find((tool) => tool.name === "run_routine_now"),
      ).toMatchObject({ replay: "safe" });

      const result = await interruptAndResume({
        capability,
        tool: "run_routine_now",
        args: { id: "c15-routine" },
        death,
        conversationId: async (ref) => {
          const bot = await seedBot({ conversationId: String(ref) });
          await db.insert(routines).values({
            id: "c15-routine",
            botId: bot.id,
            name: "Standup",
            prompt: "Post the standup",
            schedule: { kind: "cron", expr: "0 9 * * *" },
          });
        },
        beforeResume: () => vi.setSystemTime(Date.now() + 60_000),
      });

      expect(death.effects()).toBe(2);
      const runs = await db.query.routineRuns.findMany({
        where: eq(routineRuns.routineId, "c15-routine"),
      });
      expect(runs.map((run) => run.trigger)).toEqual(["manual", "manual"]);
      expect(app.submit).toHaveBeenCalledTimes(2);
      const second = runs.find((run) => run.scheduledFor.getTime() === Date.now())!;
      expect(result).toBe(
        `Routine c15-routine is running now (run ${second.id}); its reply lands in this chat.`,
      );
    },
  );

  it(
    "does not re-run forget: no replay mode, the gate reports it interrupted",
    { timeout: 30_000 },
    async () => {
      const death = dieOnce();
      const forgotten: string[] = [];
      const store: MemoryStore = {
        list: async () => [],
        forget: async (_id, input) => {
          forgotten.push(input.text);
          await death.after();
          return { status: "forgotten", removed: ["The owner lives in Pune."] };
        },
      };
      const capability = () => createMemoryCapability(store);
      const forget = capability().extension.tools?.find((tool) => tool.name === "forget");
      expect(forget).toBeDefined();
      expect(forget!.replay).toBeUndefined();

      const result = await interruptAndResume({
        capability,
        tool: "forget",
        args: { text: "Pune" },
        death,
      });

      expect(forgotten).toEqual(["Pune"]);
      expect(result).toBe("Tool forget was interrupted by a restart and may have partially run.");
    },
  );
});
