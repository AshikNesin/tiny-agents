/**
 * The computer toolkit behind the approval gate (issue #108), on real
 * pi-durable turns: closing shortcuts and closing windows ask even under
 * always-allow, the takeover request shows as its own card, and a vault
 * value typed into a window never reaches the model or the transcript.
 */
import type { Context as PiContext, JsonObject } from "@earendil-works/pi-ai";
import { until } from "../../fixtures/until";
import { loaded } from "../../fixtures/loaded-tools";
import { afterEach, describe, expect, it } from "vite-plus/test";
import type { Capability, ToolPermission } from "../../../../packages/agent/src/capabilities";
import { secretRedactor } from "../../../../packages/agent/src/redact";
import type { AgentRuntime } from "../../../../packages/agent/src/runtime";
import {
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  openTestRuntime,
  TEST_MODEL,
} from "../../../../packages/agent/src/testing";
import {
  createComputerSessions,
  createComputerToolkit,
  type ComputerSessions,
} from "../../../../packages/agent/src/toolkits/computer";
import type { ChatEvent, ChatState, ChatToolCall } from "../../../../packages/agent/src/types";
import {
  SecretValue,
  VaultError,
  type VaultBroker,
  type VaultItemMeta,
  type VaultUse,
} from "../../../../packages/agent/src/vault";
import { fakeComputer } from "./computer-fakes";

const CANARY = "canary-pw-77c1d0e2";

function callThenReport(tool: string, args: JsonObject) {
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

const lastCall = (events: ChatEvent[], name: string): ChatToolCall | undefined =>
  reduce(events)
    ?.messages.flatMap((m) => m.toolCalls ?? [])
    .findLast((call) => call.name === name);

const results = (events: ChatEvent[]) =>
  reduce(events)
    ?.messages.filter((m) => m.text.startsWith("RESULT:"))
    .map((m) => m.text.slice(7)) ?? [];

const runtimes: AgentRuntime[] = [];
const managers: ComputerSessions[] = [];
afterEach(async () => {
  await Promise.allSettled(runtimes.splice(0).map((runtime) => runtime.close()));
  await Promise.allSettled(managers.splice(0).map((m) => m.closeAll()));
  secretRedactor.clear();
});

async function openWith(
  capability: Capability,
  respondWith: ReturnType<typeof callThenReport>,
  permissions: Record<string, ToolPermission>,
) {
  const runtime = await openTestRuntime({
    storePath: ":memory:",
    capabilities: [loaded(capability)],
    respondWith,
  });
  runtimes.push(runtime);
  const ref = await runtime.createConversation({
    modelId: TEST_MODEL,
    systemPrompt: "",
    capabilities: { enabled: [capability.id], permissions },
  });
  const events: ChatEvent[] = [];
  await runtime.watchChat(ref, (batch) => {
    events.push(...batch);
  });
  return { runtime, ref, events };
}

function computer(options: { vault?: VaultBroker } = {}) {
  const fake = fakeComputer();
  const sessions = createComputerSessions({ transport: fake.transport });
  managers.push(sessions);
  const toolkit = createComputerToolkit({ sessions, settleMs: 0, vault: options.vault });
  return { fake, sessions, toolkit };
}

function loginBroker() {
  const item: VaultItemMeta = {
    handle: "mail",
    kind: "login",
    label: "Mail",
    username: "owner@example.com",
    origins: [],
    allowedHosts: [],
    hasTotp: false,
    approval: "allowed",
    tools: ["computer_fill_secret"],
  };
  const uses: VaultUse[] = [];
  const planOf = async (use: VaultUse) =>
    use.handle !== "mail"
      ? { refused: "unknown_handle" as const, message: "No vault item." }
      : {
          // A window target asks every time, like the app's policy.
          approve: true,
          grantable: false,
          unattended: false,
          card: {
            handle: item.handle,
            label: item.label,
            kind: item.kind,
            tool: use.tool,
            target: use.target,
          },
        };
  const broker: VaultBroker = {
    list: async () => [item],
    plan: planOf,
    async use(use, fields, sink) {
      const plan = await planOf(use);
      if (plan.refused) throw new VaultError(plan.refused, plan.message);
      if (!use.approved) throw new VaultError("refused_policy", "Needs approval.");
      uses.push(use);
      const wanted = typeof fields === "function" ? fields(item) : fields;
      const value = new SecretValue(CANARY);
      secretRedactor.register(value);
      return sink(Object.fromEntries(wanted.map((f) => [f, value])), item);
    },
    record: async () => undefined,
    requested: async () => ({}),
  };
  return { broker, uses };
}

const allowAll: Record<string, ToolPermission> = {
  computer_key: "allow",
  computer_close_window: "allow",
  computer_click: "allow",
  computer_fill_secret: "allow",
};

describe("computer tools behind the gate", () => {
  it("runs an ordinary shortcut under always-allow", async () => {
    const { fake, toolkit } = computer();
    const { runtime, ref, events } = await openWith(
      toolkit,
      callThenReport("computer_key", { keys: "ctrl+s" }),
      allowAll,
    );
    await runtime.submit(ref, { requestId: "r1", text: "save" });
    await until(() => results(events).length === 1, "result");
    expect(fake.log.find((e) => e.method === "key")?.args).toEqual({
      chords: ["ctrl+s"],
      repeat: 1,
    });
  }, 20_000);

  it("asks for a closing shortcut even under always-allow", async () => {
    const { fake, toolkit } = computer();
    const { runtime, ref, events } = await openWith(
      toolkit,
      callThenReport("computer_key", { keys: "alt+F4" }),
      allowAll,
    );
    await runtime.submit(ref, { requestId: "r1", text: "close it" });
    const waiting = await until(
      () =>
        lastCall(events, "computer_key")?.status === "awaiting_approval"
          ? lastCall(events, "computer_key")
          : undefined,
      "approval",
    );
    expect(fake.log.filter((e) => e.method === "key")).toEqual([]);
    await runtime.decideApproval(ref, waiting.taskId!, "denied");
    await until(() => results(events).length === 1, "result");
    expect(fake.log.filter((e) => e.method === "key")).toEqual([]);
  }, 20_000);

  it("asks before closing a window even when the owner chose allow", async () => {
    const { fake, toolkit } = computer();
    const { runtime, ref, events } = await openWith(
      toolkit,
      callThenReport("computer_close_window", { window_id: "0x02200003" }),
      allowAll,
    );
    await runtime.submit(ref, { requestId: "r1", text: "close mousepad" });
    const waiting = await until(
      () =>
        lastCall(events, "computer_close_window")?.status === "awaiting_approval"
          ? lastCall(events, "computer_close_window")
          : undefined,
      "approval",
    );
    await runtime.decideApproval(ref, waiting.taskId!, "approved");
    await until(() => results(events).length === 1, "result");
    expect(fake.log.find((e) => e.method === "closeWindow")?.args).toEqual({ id: "0x02200003" });
  }, 20_000);

  it("shows a takeover request as its own card until the owner hands back", async () => {
    const { sessions, toolkit } = computer();
    const { runtime, ref, events } = await openWith(
      toolkit,
      callThenReport("computer_request_takeover", { reason: "Sign in to Mail" }),
      {},
    );
    await runtime.submit(ref, { requestId: "r1", text: "check mail" });
    const waiting = await until(
      () =>
        lastCall(events, "computer_request_takeover")?.status === "awaiting_takeover"
          ? lastCall(events, "computer_request_takeover")
          : undefined,
      "takeover card",
    );
    expect(waiting.takeover).toEqual({ status: "pending", reason: "Sign in to Mail" });
    expect(sessions.get("shared")?.driver).toBe("human");
    await sessions.setDriver("shared", "agent");
    await until(() => results(events).length === 1, "result");
    expect(lastCall(events, "computer_request_takeover")).toMatchObject({
      status: "done",
      takeover: { status: "released", reason: "Sign in to Mail" },
    });
  }, 20_000);

  it("types a vault login into the bound window without the value reaching the chat", async () => {
    const { broker, uses } = loginBroker();
    const { fake, toolkit } = computer({ vault: broker });
    const { runtime, ref, events } = await openWith(
      toolkit,
      callThenReport("computer_fill_secret", {
        handle: "mail",
        window_class: "mousepad",
        window_title: "untitled",
      }),
      allowAll,
    );
    await runtime.submit(ref, { requestId: "r1", text: "sign in" });
    const waiting = await until(
      () =>
        lastCall(events, "computer_fill_secret")?.status === "awaiting_approval"
          ? lastCall(events, "computer_fill_secret")
          : undefined,
      "vault approval",
    );
    expect(waiting.vault).toMatchObject({
      handle: "mail",
      target: "mousepad — “untitled”",
      grantable: false,
    });
    await runtime.decideApproval(ref, waiting.taskId!, "approved");
    await until(() => results(events).length === 1, "result");
    expect(fake.typedSecrets).toEqual([
      { value: CANARY, binding: { windowClass: "mousepad", title: "untitled" } },
    ]);
    expect(uses[0]).toMatchObject({ tool: "computer_fill_secret", targetKind: "window" });
    expect(JSON.stringify(reduce(events))).not.toContain(CANARY);
  }, 20_000);

  it("types nothing when another window is in front", async () => {
    const { broker } = loginBroker();
    const { fake, toolkit } = computer({ vault: broker });
    const { runtime, ref, events } = await openWith(
      toolkit,
      callThenReport("computer_fill_secret", { handle: "mail", window_class: "firefox" }),
      allowAll,
    );
    await runtime.submit(ref, { requestId: "r1", text: "sign in" });
    const waiting = await until(
      () =>
        lastCall(events, "computer_fill_secret")?.status === "awaiting_approval"
          ? lastCall(events, "computer_fill_secret")
          : undefined,
      "vault approval",
    );
    await runtime.decideApproval(ref, waiting.taskId!, "approved");
    await until(() => results(events).length === 1, "result");
    expect(results(events)[0]).toMatch(/Nothing was typed/);
    expect(fake.typedSecrets).toEqual([]);
    expect(JSON.stringify(reduce(events))).not.toContain(CANARY);
  }, 20_000);
});
