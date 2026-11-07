/**
 * The browser's vault tools (issue #56) on real pi-durable turns with a fake
 * page: `browser_fill_secret` binds to the page's origin and reports only
 * the keys filled, and `request_credentials` waits for the owner's sheet,
 * holds no value, and resumes with the outcome.
 */
import type { Context as PiContext, JsonObject } from "@earendil-works/pi-ai";
import { until } from "../../fixtures/until";
import { afterEach, describe, expect, it } from "vite-plus/test";
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
  closeAllBrowserSessions,
  conversationBrowserTarget,
  createBrowserSessions,
  createBrowserToolkit,
  type BrowserSession,
} from "../../../../packages/agent/src/toolkits/browser";
import {
  OriginMismatchError,
  type SecretFill,
} from "../../../../packages/agent/src/toolkits/browser-fill";
import type { ChatEvent, ChatState, ChatToolCall } from "../../../../packages/agent/src/types";
import {
  SecretValue,
  VaultError,
  type VaultBroker,
  type VaultItemMeta,
  type VaultUse,
} from "../../../../packages/agent/src/vault";
import { WaitTracker } from "../../../../packages/agent/src/waiting";

const CANARY = "canary-gh-Lr8x";

function fakePage(start: string) {
  const state = {
    origin: start,
    /** The page navigates here as the fill starts (a redirect racing the call). */
    movesTo: undefined as string | undefined,
    fills: [] as { origin: string; values: Record<string, string> }[],
  };
  const session: BrowserSession = {
    url: () => `${state.origin}/`,
    origin: async () => state.origin,
    fillSecret: async (fill: SecretFill) => {
      if (state.movesTo) state.origin = state.movesTo;
      if (fill.origin !== state.origin) throw new OriginMismatchError(state.origin);
      state.fills.push({
        origin: fill.origin,
        values: Object.fromEntries(fill.fields.map((f) => [f.key, f.value.reveal()])),
      });
      return { filled: fill.fields.map((f) => f.key) };
    },
    navigate: async (url) => ({ url, status: 200 }),
    // The page echoes what was typed, as some do.
    snapshot: async () => `textbox "Password": ${state.fills.at(-1)?.values.password ?? ""}`,
    click: async () => ({ url: state.origin }),
    type: async () => ({ url: state.origin }),
    press: async () => {},
    scroll: async () => {},
    screenshot: async () => ({ data: "" }),
    close: async () => {},
  };
  return { session, state };
}

function loginBroker(): VaultBroker & { uses: VaultUse[] } {
  const item: VaultItemMeta = {
    handle: "github",
    kind: "login",
    label: "GitHub",
    username: "ana",
    origins: ["https://github.com"],
    allowedHosts: [],
    hasTotp: false,
    approval: "allowed",
    tools: ["browser_fill_secret", "browser_enter_code"],
  };
  const uses: VaultUse[] = [];
  const plan = async (use: VaultUse) =>
    item.origins.includes(use.target)
      ? {
          approve: false,
          grantable: true,
          unattended: false,
          card: {
            handle: "github",
            label: "GitHub",
            kind: "login" as const,
            tool: use.tool,
            target: use.target,
          },
        }
      : {
          refused: "refused_origin" as const,
          message: `Only fills on https://github.com, not ${use.target}.`,
        };
  return {
    uses,
    list: async () => [item],
    plan,
    async use(use, fields, sink) {
      const decided = await plan(use);
      if (decided.refused) throw new VaultError(decided.refused, decided.message);
      uses.push(use);
      const wanted = typeof fields === "function" ? fields(item) : fields;
      const value = new SecretValue(CANARY);
      secretRedactor.register(value);
      return sink(Object.fromEntries(wanted.map((f) => [f, value])), item);
    },
    record: async () => {},
    requested: async () => ({ savedHandle: "github" }),
  };
}

/** Faux model: runs `steps` in order, one tool call per turn, then reports every result. */
function script(steps: [string, JsonObject][]) {
  return (context: PiContext) => {
    const done = context.messages.filter((m) => m.role === "toolResult").length;
    if (done < steps.length) {
      const [tool, args] = steps[done];
      return {
        ...fauxAssistantMessage([fauxToolCall(tool, args)]),
        stopReason: "toolUse" as const,
      };
    }
    const texts = context.messages
      .filter((m) => m.role === "toolResult")
      .map((m) =>
        Array.isArray(m.content)
          ? m.content.map((b) => (b.type === "text" ? b.text : "")).join("")
          : "",
      );
    return fauxAssistantMessage([fauxText(`RESULT:${texts.join(" | ")}`)]);
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
    } else if (state && event.type === "busy") state.busy = event.busy;
  }
  return state;
}

const lastCall = (events: ChatEvent[], name: string): ChatToolCall | undefined =>
  reduce(events)
    ?.messages.flatMap((m) => m.toolCalls ?? [])
    .findLast((call) => call.name === name);

const result = (events: ChatEvent[]) =>
  reduce(events)
    ?.messages.find((m) => m.text.startsWith("RESULT:"))
    ?.text.slice(7);

const runtimes: AgentRuntime[] = [];
afterEach(async () => {
  await Promise.allSettled(runtimes.splice(0).map((runtime) => runtime.close()));
  await closeAllBrowserSessions();
  secretRedactor.clear();
});

async function open(
  page: ReturnType<typeof fakePage>,
  steps: [string, JsonObject][],
  options: { unattended?: boolean } = {},
) {
  const tracker = new WaitTracker();
  const broker = loginBroker();
  // The page is already open in the bot's browser: planning a fill never
  // launches one, so the test opens it the way an earlier navigate would.
  const sessions = createBrowserSessions({ transport: async () => page.session });
  const browser = createBrowserToolkit({ sessions, vault: broker, ownerWaits: tracker });
  const runtime = await openTestRuntime({
    storePath: ":memory:",
    capabilities: [browser],
    approvalTracker: tracker,
    respondWith: script(steps),
  });
  runtimes.push(runtime);
  const ref = await runtime.createConversation({
    modelId: TEST_MODEL,
    systemPrompt: "",
    capabilities: {
      enabled: ["browser"],
      permissions: { browser_fill_secret: "allow", browser_snapshot: "allow" },
      ...(options.unattended ? { unattended: true } : {}),
    },
  });
  await sessions.acquire(conversationBrowserTarget(Number(ref)));
  const events: ChatEvent[] = [];
  await runtime.watchChat(ref, (batch) => {
    events.push(...batch);
  });
  return { runtime, ref, events, broker };
}

describe("browser_fill_secret", () => {
  it("fills on the item's origin and keeps the value out of every result", async () => {
    const page = fakePage("https://github.com");
    const { runtime, ref, events, broker } = await open(page, [
      ["browser_fill_secret", { handle: "github" }],
      ["browser_snapshot", {}],
    ]);
    await runtime.submit(ref, { requestId: "r1", text: "sign in" });
    const text = await until(() => result(events), "result");
    expect(page.state.fills).toEqual([
      { origin: "https://github.com", values: { password: CANARY } },
    ]);
    expect(broker.uses[0]).toMatchObject({
      target: "https://github.com",
      tool: "browser_fill_secret",
    });
    expect(text).toContain('"filled":["password"]');
    // The snapshot echoed the password; the gate scrubbed it.
    expect(text).toContain("[vault]");
    expect(JSON.stringify(reduce(events))).not.toContain(CANARY);
  }, 20_000);

  it("fills nothing when the page moves as the fill starts, and says where it went", async () => {
    const page = fakePage("https://github.com");
    page.state.movesTo = "https://github.com.evil.example";
    const { runtime, ref, events } = await open(page, [
      ["browser_fill_secret", { handle: "github" }],
    ]);
    await runtime.submit(ref, { requestId: "r1", text: "sign in" });
    expect(await until(() => result(events), "result")).toBe(
      "The page is now on https://github.com.evil.example, not the origin this call was approved for. Nothing was filled.",
    );
    expect(page.state.fills).toEqual([]);
    expect(JSON.stringify(reduce(events))).not.toContain(CANARY);
  }, 20_000);

  it("refuses another origin without resolving anything", async () => {
    const page = fakePage("https://github.com.evil.example");
    const { runtime, ref, events, broker } = await open(page, [
      ["browser_fill_secret", { handle: "github" }],
    ]);
    await runtime.submit(ref, { requestId: "r1", text: "sign in" });
    expect(await until(() => result(events), "result")).toContain(
      "Only fills on https://github.com",
    );
    expect(page.state.fills).toEqual([]);
    expect(broker.uses).toEqual([]);
  }, 20_000);
});

describe("request_credentials", () => {
  const ask: JsonObject = {
    title: "Sign in to Umami",
    purpose: "Read the analytics",
    fields: [
      { key: "email", label: "Email", type: "email", autocomplete: "email" },
      { key: "password", label: "Password", type: "password" },
    ],
  };

  it("waits for the owner's sheet and resumes with the keys filled", async () => {
    const page = fakePage("https://hi.nesin.io");
    const { runtime, ref, events } = await open(page, [["request_credentials", ask]]);
    await runtime.submit(ref, { requestId: "r1", text: "check umami" });
    const waiting = await until(
      () =>
        lastCall(events, "request_credentials")?.status === "awaiting_credentials"
          ? lastCall(events, "request_credentials")
          : undefined,
      "credential request",
    );
    expect(waiting.credentials).toMatchObject({
      status: "pending",
      origin: "https://hi.nesin.io",
      title: "Sign in to Umami",
      fields: [
        { key: "email", type: "email", required: true },
        { key: "password", type: "password", required: true },
      ],
    });
    expect(runtime.pendingApprovals(ref)).toBe(1);

    const pending = await runtime.credentialRequest(waiting.taskId!);
    expect(pending).toMatchObject({
      conversation: ref,
      request: { origin: "https://hi.nesin.io", savedHandle: "github" },
    });
    await runtime.settleCredentialRequest(waiting.taskId!, {
      status: "filled",
      filled: ["email", "password"],
      savedHandle: "hi-nesin-io",
    });
    const text = await until(() => result(events), "result");
    expect(JSON.parse(text.slice(0, text.indexOf("}") + 1))).toEqual({
      status: "filled",
      filled_fields: ["email", "password"],
      saved_item_handle: "hi-nesin-io",
    });
    expect(lastCall(events, "request_credentials")?.credentials).toMatchObject({
      status: "filled",
    });
    await expect(runtime.credentialRequest(waiting.taskId!)).rejects.toThrow(/not waiting/);
  }, 20_000);

  it("never opens a sheet in an unattended conversation (a routine run, issue #63)", async () => {
    const page = fakePage("https://hi.nesin.io");
    const { runtime, ref, events } = await open(page, [["request_credentials", ask]], {
      unattended: true,
    });
    await runtime.submit(ref, { requestId: "r1", text: "check umami" });
    expect(await until(() => result(events), "result")).toMatch(/Nobody can fill credentials/);
    expect(runtime.pendingApprovals(ref)).toBe(0);
  }, 20_000);

  it("refuses free-text fields", async () => {
    const page = fakePage("https://hi.nesin.io");
    const { runtime, ref, events } = await open(page, [
      [
        "request_credentials",
        {
          ...ask,
          fields: [{ key: "notes", label: "Anything else?", type: "text", autocomplete: "off" }],
        },
      ],
    ]);
    await runtime.submit(ref, { requestId: "r1", text: "go" });
    expect(await until(() => result(events), "result")).toContain(
      "free-text fields are not allowed",
    );
    expect(runtime.pendingApprovals(ref)).toBe(0);
  }, 20_000);

  it("refuses non-https pages", async () => {
    const page = fakePage("http://example.com");
    const { runtime, ref, events } = await open(page, [["request_credentials", ask]]);
    await runtime.submit(ref, { requestId: "r1", text: "go" });
    expect(await until(() => result(events), "result")).toContain(
      "only be requested for an https page",
    );
    expect(runtime.pendingApprovals(ref)).toBe(0);
  }, 20_000);
});
