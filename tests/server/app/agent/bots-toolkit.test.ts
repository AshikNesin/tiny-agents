/**
 * The `bots` toolkit (issue #12): message_bot delivers through the injected
 * BotMessagingStore, keyed on the durable tool task so replays dedupe, and
 * the roster section lists the other bots only when there are any.
 */
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ProviderState } from "@earendil-works/pi-durable";
import { ProviderDoc } from "@earendil-works/pi-durable";
import type { ToolExecutionApi, ToolExecutionResult } from "@earendil-works/pi-durable";
import { describe, expect, it } from "vite-plus/test";
import type { Capability } from "../../../../packages/agent/src/capabilities";
import {
  createBotsToolkit,
  type BotMessagingStore,
} from "../../../../packages/agent/src/toolkits/bots";

interface MemoryStore extends BotMessagingStore {
  /** Every deliver invocation, replays included. */
  invocations: { toName: string; text: string; requestId: string; sourceKey: string }[];
  /** Rows the "unique requestId column" accepted: one per real delivery. */
  deliveries: string[];
  roster: { name: string; description: string }[];
  nextResult: { delivered: boolean; reason?: "unknown_bot" | "self" | "loop" };
}

function memoryStore(
  roster: { name: string; description: string }[] = [],
  nextResult: MemoryStore["nextResult"] = { delivered: true },
): MemoryStore {
  const invocations: MemoryStore["invocations"] = [];
  const deliveries: string[] = [];
  return {
    invocations,
    deliveries,
    roster,
    nextResult,
    async deliver(input) {
      invocations.push(input);
      if (!this.nextResult.delivered) return { ...this.nextResult };
      // Simulates the app store's requestId unique column: a replayed deliver
      // finds the existing row and reports success without a second insert.
      if (!deliveries.includes(input.requestId)) deliveries.push(input.requestId);
      return { delivered: true };
    },
    async roster() {
      return roster;
    },
  };
}

/** A ToolExecutionApi with just what message_bot reads: ids and the provider snapshot. */
function api(overrides: Partial<ToolExecutionApi> = {}): ToolExecutionApi {
  const base = {
    taskId: 7,
    conversationId: 3,
    callId: "call_0",
    async snapshot(token: typeof ProviderDoc, conversationId: number) {
      return token === ProviderDoc && conversationId === 3
        ? ({ sessionId: "sess-abc" } satisfies ProviderState)
        : undefined;
    },
  } as unknown as ToolExecutionApi;
  return Object.assign(base, overrides);
}

async function run(
  capability: Capability,
  args: Record<string, unknown>,
  apiOverride?: ToolExecutionApi,
) {
  const tool = capability.extension.tools!.find((t) => t.name === "message_bot")!;
  const result = (await tool.execute(
    args as never,
    apiOverride ?? api(),
    BACKGROUND_CONTEXT,
  )) as ToolExecutionResult;
  const text = (result.output ?? []).map((b) => (b.type === "text" ? b.text : "")).join("");
  return { ...result, text };
}

describe("bots toolkit", () => {
  it("delivers once and names the target in the success text", async () => {
    const store = memoryStore();
    const bots = createBotsToolkit(store);
    const result = await run(bots, { to: "Researcher", text: "Any news on the API?" });
    expect(result.isError).toBeUndefined();
    expect(result.text).toContain("Researcher");
    expect(store.invocations).toHaveLength(1);
    expect(store.invocations[0]).toMatchObject({
      toName: "Researcher",
      text: "Any news on the API?",
      conversationId: 3,
    });
    expect(store.deliveries).toEqual(["botmsg-pi:sess-abc:7"]);
  });

  it("derives requestId from the durable tool task, not the provider call id", async () => {
    const store = memoryStore();
    const bots = createBotsToolkit(store);
    await run(bots, { to: "Researcher", text: "one" }, api({ callId: "" }));
    await run(bots, { to: "Researcher", text: "two" }, api({ callId: "" }));
    expect(store.invocations.map((call) => call.requestId)).toEqual([
      "botmsg-pi:sess-abc:7",
      "botmsg-pi:sess-abc:7",
    ]);
    // A different task (a later tool call) gets its own keys.
    await run(bots, { to: "Researcher", text: "three" }, api({ taskId: 8 }));
    expect(store.invocations[2]).toMatchObject({ requestId: "botmsg-pi:sess-abc:8" });
  });

  it("falls back to the conversation id when the provider doc is missing", async () => {
    const store = memoryStore();
    const bots = createBotsToolkit(store);
    const legacy = api({
      snapshot: async () => undefined,
    });
    await run(bots, { to: "Researcher", text: "legacy" }, legacy);
    expect(store.invocations[0]).toMatchObject({
      sourceKey: "pi:conversation-3:7",
      requestId: "botmsg-pi:conversation-3:7",
    });
  });

  it("replays dedupe: two executes with the same api result in one delivery", async () => {
    const store = memoryStore();
    const bots = createBotsToolkit(store);
    const first = await run(bots, { to: "Researcher", text: "exactly once" });
    const second = await run(bots, { to: "Researcher", text: "exactly once" });
    expect(first.isError).toBeUndefined();
    expect(second.isError).toBeUndefined();
    // Both runs derived the same deterministic requestId (same durable tool
    // task, same session), so the store's unique column accepted one row:
    // two invocations, exactly one delivery.
    expect(store.invocations).toHaveLength(2);
    expect(store.deliveries).toEqual(["botmsg-pi:sess-abc:7"]);
  });

  it("reports an unknown bot as an error naming the reason", async () => {
    const store = memoryStore([], { delivered: false, reason: "unknown_bot" });
    const result = await run(createBotsToolkit(store), { to: "Ghost", text: "hi" });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("Ghost");
    expect(result.text).toContain("unknown_bot");
    expect(store.deliveries).toEqual([]);
  });

  it("refuses messaging itself", async () => {
    const store = memoryStore([], { delivered: false, reason: "self" });
    const result = await run(createBotsToolkit(store), { to: "Me", text: "note to self" });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("self");
  });

  it("refuses when the loop guard trips", async () => {
    const store = memoryStore([], { delivered: false, reason: "loop" });
    const result = await run(createBotsToolkit(store), { to: "Researcher", text: "again" });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("loop");
  });

  it("lists the roster in the prompt section and stays silent when it is empty", async () => {
    const store = memoryStore([
      { name: "Researcher", description: "Digs into sources" },
      { name: "Writer", description: "Drafts posts" },
    ]);
    const bots = createBotsToolkit(store);
    const roster = bots.extension.sections!.find((s) => s.key === "bots")!;
    const text = await roster.render({ conversationId: 3 } as never, BACKGROUND_CONTEXT);
    expect(text).toContain("You can message these bots with message_bot(to, text).");
    expect(text).toContain("- Researcher: Digs into sources");
    expect(text).toContain("- Writer: Drafts posts");

    const empty = memoryStore([]);
    const noRoster = createBotsToolkit(empty).extension.sections!.find((s) => s.key === "bots")!;
    expect(
      await noRoster.render({ conversationId: 3 } as never, BACKGROUND_CONTEXT),
    ).toBeUndefined();
  });

  it("exposes UI metadata: default ask, never read-only or ask-only", () => {
    const bots = createBotsToolkit(memoryStore());
    expect(bots.id).toBe("bots");
    expect(bots.kind).toBe("toolkit");
    expect(bots.tools).toEqual([
      {
        name: "message_bot",
        label: "Messaged bot",
        description: "Send a message to another bot",
      },
    ]);
  });
});
