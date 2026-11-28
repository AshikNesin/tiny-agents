import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { JsonValue } from "@earendil-works/pi-ai";
import type { ToolExecutionApi, ToolExecutionResult } from "@earendil-works/pi-durable";
import { describe, expect, it } from "vite-plus/test";
import type { VaultBroker } from "../../../../packages/agent/src/vault";
import { createWebToolkit, type PinnedFetch } from "../../../../packages/agent/src/toolkits/web";

function fakeApi(): ToolExecutionApi {
  const memos = new Map<string, JsonValue>();
  return {
    conversationId: "7",
    memo: async (name: string, ...rest: unknown[]) => {
      if (rest.length === 2 && !memos.has(name)) memos.set(name, rest[0] as JsonValue);
      return memos.get(name);
    },
    snapshot: async () => undefined,
  } as unknown as ToolExecutionApi;
}

const CANARY = "sk-canary-8c1f40b2";

function broker(): { broker: VaultBroker; opened: boolean } {
  const state = { opened: false };
  const item = {
    handle: "openai",
    kind: "api_key" as const,
    label: "OpenAI",
    origins: [],
    allowedHosts: ["api.example.com", "plain.example.com"],
    inject: { as: "header" as const, name: "Authorization", format: "Bearer {value}" },
    hasTotp: false,
    approval: "allowed" as const,
    tools: ["http_request"],
  };
  return {
    broker: {
      list: async () => [item],
      plan: async (use) => ({
        approve: false,
        grantable: false,
        unattended: false,
        card: {
          handle: item.handle,
          label: item.label,
          kind: item.kind,
          tool: use.tool,
          target: use.target,
        },
      }),
      async use(use, fields, sink) {
        state.opened = true;
        const wanted = typeof fields === "function" ? fields(item) : fields;
        const values = Object.fromEntries(wanted.map((field) => [field, { reveal: () => CANARY }]));
        return sink(values as never, item);
      },
      record: async () => undefined,
      requested: async () => ({}),
    },
    get opened() {
      return state.opened;
    },
  };
}

async function run(
  web: ReturnType<typeof createWebToolkit>,
  args: Record<string, unknown>,
): Promise<{ isError?: boolean; text: string }> {
  const tool = web.extension.tools!.find((t) => t.name === "http_request")!;
  const result = (await tool.execute(
    args as never,
    fakeApi(),
    BACKGROUND_CONTEXT,
  )) as ToolExecutionResult;
  const text = (result.output ?? []).map((b) => (b.type === "text" ? b.text : "")).join("");
  return { ...result, text };
}

type Hop = { url: string; authorization?: string };

function hops(log: Hop[]) {
  return (async (url: URL, _addresses: readonly string[], init: RequestInit) => {
    const authorization = new Headers(init.headers as HeadersInit).get("authorization");
    log.push({ url: url.href, ...(authorization ? { authorization } : {}) });
    return new Response("ok", { status: 200 });
  }) as PinnedFetch;
}

describe("http_request keeps vault credentials off plaintext http", () => {
  it("sends the vault header to an https URL", async () => {
    const vault = broker();
    const log: Hop[] = [];
    const web = createWebToolkit({
      vault: vault.broker,
      sendPinned: hops(log),
      resolveHost: async () => ["93.184.216.34"],
    });
    const result = await run(web, { url: "https://api.example.com/v1/me", auth: "openai" });
    expect(result.isError).toBeUndefined();
    expect(log).toEqual([
      { url: "https://api.example.com/v1/me", authorization: `Bearer ${CANARY}` },
    ]);
  });

  it("refuses a vault credential on a direct http URL without sending anything", async () => {
    const vault = broker();
    const log: Hop[] = [];
    const web = createWebToolkit({
      vault: vault.broker,
      sendPinned: hops(log),
      resolveHost: async () => ["93.184.216.34"],
    });
    const result = await run(web, { url: "http://plain.example.com/v1/me", auth: "openai" });
    expect(result.isError).toBe(true);
    expect(result.text).toBe(
      "Vault credentials can't be sent over plain http: plain.example.com is not an https URL.",
    );
    expect(log).toEqual([]);
    expect(vault.opened).toBe(false);
  });

  it("refuses an https to http redirect on the same host, after the first hop", async () => {
    const vault = broker();
    const log: Hop[] = [];
    const redirecting = (async (url: URL) => {
      log.push({ url: url.href });
      if (url.protocol === "https:")
        return new Response(null, {
          status: 302,
          headers: { location: "http://api.example.com/v1/me" },
        });
      return new Response("leaked", { status: 200 });
    }) as unknown as PinnedFetch;
    const web = createWebToolkit({
      vault: vault.broker,
      sendPinned: redirecting,
      resolveHost: async () => ["93.184.216.34"],
    });
    const result = await run(web, { url: "https://api.example.com/v1/me", auth: "openai" });
    expect(result.isError).toBe(true);
    expect(result.text).toBe(
      "Vault credentials can't be sent over plain http: api.example.com is not an https URL.",
    );
    expect(log).toEqual([{ url: "https://api.example.com/v1/me" }]);
  });

  it("still makes a plain http request without a vault credential", async () => {
    const vault = broker();
    const log: Hop[] = [];
    const web = createWebToolkit({
      vault: vault.broker,
      sendPinned: hops(log),
      resolveHost: async () => ["93.184.216.34"],
    });
    const result = await run(web, { url: "http://plain.example.com/v1/me" });
    expect(result.isError).toBeUndefined();
    expect(log).toEqual([{ url: "http://plain.example.com/v1/me" }]);
  });
});

describe("http_request when the host does not resolve", () => {
  it("says why the lookup failed and sends nothing", async () => {
    const log: Hop[] = [];
    const web = createWebToolkit({
      vault: broker().broker,
      sendPinned: hops(log),
      resolveHost: async () => {
        throw new Error("getaddrinfo EAI_AGAIN api.example.com");
      },
    });
    const result = await run(web, { url: "https://api.example.com/v1/me" });
    expect(result.isError).toBe(true);
    expect(result.text).toBe(
      "Could not resolve api.example.com: getaddrinfo EAI_AGAIN api.example.com",
    );
    expect(log).toEqual([]);
  });
});
