import { createServer, type IncomingMessage, type RequestListener, type Server } from "node:http";
import { fakeCatalog, useTestRuntime } from "../fixtures";
import type { AddressInfo } from "node:net";
import { nodeRequestListener } from "../../../apps/web/src/server/node-listener";
import { Hono } from "hono";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";
import {
  botConnections,
  botGuests,
  bots,
  connections,
  db,
  guests,
  users,
  vaultAuditEvents,
  vaultItems,
  vaultValues,
} from "../../../apps/web/src/server/db";
import { eq } from "drizzle-orm";
import { McpServer, StreamableHTTPServerTransport } from "../../../packages/agent/src/testing";
import {
  ConnectionManager,
  setConnectionManagerForTests,
} from "../../../apps/web/src/server/api/connections/connections.manager";
import { api, createTestApp, type TestApp } from "../helpers";
import { authToken, until } from "../fixtures";
import { issueStepUp } from "../../../apps/web/src/server/api/vault/vault.stepup";
import { readOAuthState } from "../../../apps/web/src/server/api/connections/oauth";
import { FIXED_NOW } from "../../test-clock";
import { memoryRateLimitStore } from "@groot/core/rate-limit/store";

let token: string;
beforeAll(async () => {
  token = await authToken("mcp@example.com");
});

const buildApp = (): TestApp => createTestApp();

// oxlint-disable-next-line typescript/no-explicit-any
type Data = any;

async function call(
  app: TestApp,
  path: string,
  status: number,
  init: { method?: string; json?: unknown; stepUp?: false } = {},
) {
  const headers: Record<string, string> =
    init.stepUp === false ? {} : { "X-Vault-Step-Up": issueStepUp(1).token };
  const response = await api<Data>(app, path, {
    method: init.method ?? "GET",
    token,
    headers,
    ...(init.json !== undefined ? { json: init.json } : {}),
  });
  expect(response.status, `${init.method ?? "GET"} ${path}: ${JSON.stringify(response.body)}`).toBe(
    status,
  );
  return response.body;
}

async function listen(handler: RequestListener) {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, port: (server.address() as AddressInfo).port };
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : undefined;
}

interface TestMcpServer {
  url: string;
  server: Server;
  tokens: Set<string>;
  delayMs: number;
}

function buildMcp(name: string, extraTools = 0) {
  const mcp = new McpServer({ name, version: "1.0.0" });
  for (let i = 0; i < extraTools; i++) {
    mcp.registerTool(`tool_${i}`, { description: `Tool ${i}`, inputSchema: {} }, async () => ({
      content: [{ type: "text", text: String(i) }],
    }));
  }
  mcp.registerTool(
    "echo",
    {
      description: "Echo a value",
      inputSchema: { value: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ value }) => ({ content: [{ type: "text", text: `echo:${value}` }] }),
  );
  mcp.registerTool("reset", { description: "Reset", inputSchema: {} }, async () => ({
    content: [{ type: "text", text: "reset" }],
  }));
  return mcp;
}

async function startMcpServer(extraTools = 0): Promise<TestMcpServer> {
  const tokens = new Set<string>(["secret123"]);
  const state = { delayMs: 0 };
  const { server, port } = await listen(async (req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (path !== "/mcp") {
      res.writeHead(404).end();
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(405).end();
      return;
    }
    if (state.delayMs > 0) await new Promise((r) => setTimeout(r, state.delayMs));
    if (!tokens.has(String(req.headers["x-api-key"] ?? ""))) {
      res.writeHead(401, { "content-type": "application/json" }).end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32001, message: "Unauthorized" },
          id: null,
        }),
      );
      return;
    }
    const mcp = buildMcp("demo-mcp", extraTools);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => void transport.close().catch(() => undefined));
    await mcp.connect(transport);
    await transport.handleRequest(req, res, await readJson(req));
  });
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    server,
    tokens,
    get delayMs() {
      return state.delayMs;
    },
    set delayMs(ms: number) {
      state.delayMs = ms;
    },
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const DEMO = { name: "Demo", authType: "header", headerName: "x-api-key", secret: "secret123" };

describe("MCP connections (header auth, streamable http)", () => {
  let mcpServer: TestMcpServer;
  let manager: ConnectionManager;
  let runtimeCalls: { install: string[]; uninstall: string[] };
  let installed: Map<string, { tools: { name: string }[] }>;
  let configured: number[];

  beforeEach(async () => {
    await db.delete(botConnections);
    await db.delete(connections);
    await db.delete(bots);
    mcpServer = await startMcpServer();
    installed = new Map();
    configured = [];
    useTestRuntime({
      configure: async () => undefined,
      catalog: fakeCatalog(),
      installCapability: (capability: { id: string }) => runtimeCalls.install.push(capability.id),
      uninstallCapability: (id: string) => runtimeCalls.uninstall.push(id),
    } as never);
    runtimeCalls = { install: [], uninstall: [] };
    manager = new ConnectionManager();
    setConnectionManagerForTests(manager);
    await manager.start({
      installCapability: (capability: { id: string; tools: { name: string }[] }) => {
        runtimeCalls.install.push(capability.id);
        installed.set(capability.id, capability);
      },
      uninstallCapability: (id: string) => runtimeCalls.uninstall.push(id),
      configure: async (conversationId: number) => void configured.push(conversationId),
      catalog: fakeCatalog(),
    } as never);
  });

  afterEach(async () => {
    await manager.close();
    setConnectionManagerForTests(undefined);
    useTestRuntime(undefined);
    await new Promise<void>((resolve) => mcpServer.server.close(() => resolve()));
    await db.delete(botConnections);
    await db.delete(connections);
    await db.delete(bots);
    await db.delete(vaultAuditEvents);
    await db.delete(vaultItems);
    await db.delete(vaultValues);
  });

  it("needs a step-up to create, re-point or delete a connection, not to rename it (S4)", async () => {
    const app = buildApp();
    const body = {
      name: "Gated",
      url: mcpServer.url,
      authType: "header",
      headerName: "x-api-key",
      secret: "s3cret",
    };
    const refused = await call(app, "/api/v1/connections", 403, {
      method: "POST",
      json: body,
      stepUp: false,
    });
    expect(refused.error?.details).toEqual({ code: "step_up_required" });
    const { data } = await call(app, "/api/v1/connections", 201, { method: "POST", json: body });
    const path = `/api/v1/connections/${data.id}`;

    await call(app, path, 200, { method: "PATCH", json: { name: "Renamed" }, stepUp: false });
    for (const change of [
      { url: mcpServer.url },
      { secret: "other" },
      { headerName: "x-key" },
      { secretRef: null },
    ]) {
      await call(app, path, 403, { method: "PATCH", json: change, stepUp: false });
    }
    await call(app, path, 403, { method: "DELETE", stepUp: false });
    await call(app, path, 200, { method: "DELETE" });
  });

  it("refuses a header secret when SECRETS_KEY is too weak to seal it, naming the variable", async () => {
    const app = buildApp();
    const key = process.env.SECRETS_KEY!;
    process.env.SECRETS_KEY = "the-old-short-key";
    try {
      const refused = await api(app, "/api/v1/connections", {
        method: "POST",
        token,
        headers: { "X-Vault-Step-Up": issueStepUp(1).token },
        json: {
          name: "Weak",
          url: mcpServer.url,
          authType: "header",
          headerName: "x-api-key",
          secret: "s",
        },
      });
      expect(refused.status).toBe(400);
      expect(refused.body.error?.message).toContain("SECRETS_KEY");
      expect(refused.body.error?.message).toContain("32");
    } finally {
      process.env.SECRETS_KEY = key;
    }
  });

  it("drops the stored header secret when the URL moves to another host (S4)", async () => {
    const app = buildApp();
    const { data } = await call(app, "/api/v1/connections", 201, {
      method: "POST",
      json: {
        name: "Mover",
        url: mcpServer.url,
        authType: "header",
        headerName: "x-api-key",
        secret: "s3cret",
      },
    });
    const path = `/api/v1/connections/${data.id}`;
    const samehost = mcpServer.url.replace("/mcp", "/mcp?v=2");
    expect(
      (await call(app, path, 200, { method: "PATCH", json: { url: samehost } })).data.hasSecret,
    ).toBe(true);
    const elsewhere = mcpServer.url.replace("127.0.0.1", "localhost");
    const moved = await call(app, path, 200, { method: "PATCH", json: { url: elsewhere } });
    expect(moved.data.hasSecret).toBe(false);
    expect((await db.query.connections.findFirst())?.secretItemId).toBeNull();
    expect(await db.select().from(vaultItems)).toEqual([]);
    const back = await call(app, path, 200, {
      method: "PATCH",
      json: { url: mcpServer.url, secret: "fresh" },
    });
    expect(back.data.hasSecret).toBe(true);
  });

  it("a host move without a new value drops the own item even with secretRef: null (S4)", async () => {
    const app = buildApp();
    const { data } = await call(app, "/api/v1/connections", 201, {
      method: "POST",
      json: { ...DEMO, name: "Probe", url: mcpServer.url },
    });
    expect(data.status).toBe("connected");
    const elsewhere = mcpServer.url.replace("127.0.0.1", "localhost");
    const moved = await call(app, `/api/v1/connections/${data.id}`, 200, {
      method: "PATCH",
      json: { url: elsewhere, secretRef: null },
    });
    expect(moved.data).toMatchObject({ hasSecret: false, secretRef: null });
    expect(moved.data.status).not.toBe("connected");
    expect((await db.query.connections.findFirst())?.secretItemId).toBeNull();
    expect(await db.select().from(vaultItems)).toEqual([]);
  });

  it("sends the own item only to the hosts it lists (S4)", async () => {
    const app = buildApp();
    const { data } = await call(app, "/api/v1/connections", 201, {
      method: "POST",
      json: { ...DEMO, name: "Scoped", url: mcpServer.url },
    });
    expect(data.status).toBe("connected");
    await call(app, "/api/v1/vault/items/mcp-scoped", 200, {
      method: "PUT",
      json: { policy: { hosts: ["mcp.elsewhere.example"] } },
    });
    const again = await call(app, `/api/v1/connections/${data.id}/reconnect`, 200, {
      method: "POST",
    });
    expect(again.data.status).toBe("error");
    expect(again.data.error).toContain("may not be sent to 127.0.0.1");
  });

  it("a new value resets the own item's policy, so it still opens (inject set in the Vault)", async () => {
    const app = buildApp();
    const { data } = await call(app, "/api/v1/connections", 201, {
      method: "POST",
      json: { ...DEMO, name: "Inject", url: mcpServer.url },
    });
    await call(app, "/api/v1/vault/items/mcp-inject", 200, {
      method: "PUT",
      json: { policy: { inject: { as: "header", name: "x-api-key", format: "{value}" } } },
    });
    mcpServer.tokens.add("secret456");
    const changed = await call(app, `/api/v1/connections/${data.id}`, 200, {
      method: "PATCH",
      json: { secret: "secret456" },
    });
    expect(changed.data.status).toBe("connected");
    expect((await db.query.vaultItems.findFirst())?.injectJson).toBeNull();
  });

  it("refuses to delete a connection's own item from the Vault page (409)", async () => {
    const app = buildApp();
    const { data } = await call(app, "/api/v1/connections", 201, {
      method: "POST",
      json: { ...DEMO, name: "Kept", url: mcpServer.url },
    });
    for (const path of [
      "/api/v1/vault/items/mcp-kept?purge=true",
      "/api/v1/vault/items/mcp-kept",
    ]) {
      const refused = await call(app, path, 409, { method: "DELETE" });
      expect(refused.error?.message).toContain("Kept");
    }
    expect(await db.select().from(vaultItems)).toHaveLength(1);
    const kept = await call(app, `/api/v1/connections/${data.id}/reconnect`, 200, {
      method: "POST",
    });
    expect(kept.data).toMatchObject({ hasSecret: true, status: "connected" });
  });

  it("keeps the header value as the connection's own vault item, deleted with it (Q4)", async () => {
    const app = buildApp();
    const { data } = await call(app, "/api/v1/connections", 201, {
      method: "POST",
      json: { ...DEMO, name: "Own", url: mcpServer.url },
    });
    expect(data).toMatchObject({ status: "connected", hasSecret: true, secretRef: null });
    const row = await db.query.connections.findFirst({ where: eq(connections.id, data.id) });
    expect(row?.secretEnc).toBeNull();
    const [item] = await db.select().from(vaultItems);
    expect(item).toMatchObject({
      id: row!.secretItemId,
      handle: "mcp-own",
      kind: "api_key",
      audience: "bots",
      hostsJson: '["127.0.0.1"]',
      toolsJson: '["mcp"]',
      botsJson: "[]",
    });
    expect(JSON.stringify(await db.select().from(vaultValues))).not.toContain("secret123");

    const path = `/api/v1/connections/${data.id}`;
    mcpServer.tokens.add("secret456");
    mcpServer.tokens.delete("secret123");
    const changed = await call(app, path, 200, { method: "PATCH", json: { secret: "secret456" } });
    expect(changed.data.status).toBe("connected");
    expect((await db.select().from(vaultItems)).map((i) => i.id)).toEqual([item!.id]);

    const shared = await call(app, path, 200, { method: "PATCH", json: { secretRef: "mcp-own" } });
    expect(shared.data).toMatchObject({ secretRef: "mcp-own", status: "connected" });
    const own = await call(app, path, 200, { method: "PATCH", json: { secretRef: null } });
    expect(own.data).toMatchObject({ secretRef: null, hasSecret: true, status: "connected" });

    await call(app, path, 200, { method: "DELETE" });
    expect(await db.select().from(vaultItems)).toEqual([]);
    expect(await db.select().from(vaultValues)).toEqual([]);
    const outcomes = (await db.select().from(vaultAuditEvents))
      .filter((event) => event.handle === "mcp-own")
      .map((event) => [event.tool, event.outcome]);
    expect(outcomes).toEqual(
      expect.arrayContaining([
        ["connections", "created"],
        ["connections", "updated"],
        ["connections", "deleted"],
      ]),
    );
  });

  it("refuses an app credential as a connection's header secret (S4)", async () => {
    const app = buildApp();
    const { data } = await call(app, "/api/v1/connections", 201, {
      method: "POST",
      json: {
        name: "Ref",
        url: mcpServer.url,
        authType: "header",
        headerName: "x-api-key",
        secret: "s3cret",
      },
    });
    await db.insert(vaultItems).values({
      handle: "model-key",
      kind: "api_key",
      backend: "local",
      audience: "app",
      externalId: "x",
      label: "Model key",
    });
    try {
      const refused = await call(app, `/api/v1/connections/${data.id}`, 400, {
        method: "PATCH",
        json: { secretRef: "model-key" },
      });
      expect(refused.error?.message).toContain("used by the app");
    } finally {
      await db.delete(vaultItems);
    }
  });

  it("tests a server, saves it connected, and lists its tools", async () => {
    const app = buildApp();
    const test = await call(app, "/api/v1/connections/test", 200, {
      method: "POST",
      json: { url: mcpServer.url, headerName: "x-api-key", secret: "secret123" },
    });
    expect(
      test.data.tools.map((t: { name: string; readOnly: boolean }) => [t.name, t.readOnly]),
    ).toEqual([
      ["echo", true],
      ["reset", false],
    ]);
    await call(app, "/api/v1/connections/test", 400, {
      method: "POST",
      json: { url: mcpServer.url },
    });

    const created = await call(app, "/api/v1/connections", 201, {
      method: "POST",
      json: {
        name: "Demo",
        url: mcpServer.url,
        authType: "header",
        headerName: "x-api-key",
        secret: "secret123",
      },
    });
    expect(created.data).toMatchObject({
      status: "connected",
      slug: "demo",
      authType: "header",
    });
    expect(created.data.tools.map((t: { name: string }) => t.name)).toEqual([
      "mcp__demo__echo",
      "mcp__demo__reset",
    ]);
    expect(runtimeCalls.install).toContain("mcp:demo");
    expect(created.data).not.toHaveProperty("secret");

    const bad = await call(app, "/api/v1/connections", 201, {
      method: "POST",
      json: {
        name: "Bad",
        url: mcpServer.url,
        authType: "header",
        headerName: "x-api-key",
        secret: "wrong",
      },
    });
    expect(bad.data.status).toBe("error");
  }, 30_000);

  it("enables a connection for a bot and re-applies its capability config", async () => {
    const app = buildApp();
    const [bot] = await db
      .insert(bots)
      .values({ name: "Ops", modelId: "m", conversationId: "950" })
      .returning();
    const created = await call(app, "/api/v1/connections", 201, {
      method: "POST",
      json: {
        name: "Demo",
        url: mcpServer.url,
        authType: "header",
        headerName: "x-api-key",
        secret: "secret123",
        botIds: [bot!.id],
      },
    });
    const patched = await call(app, `/api/v1/bots/${bot!.id}`, 200, {
      method: "PATCH",
      json: { connectionIds: [] },
    });
    expect(patched.data.connectionIds).toEqual([]);
    await call(app, `/api/v1/connections/${created.data.id}`, 200, {
      method: "PATCH",
      json: { botIds: [bot!.id] },
    });
    const detail = await call(app, `/api/v1/connections/${created.data.id}`, 200);
    expect(detail.data.botIds).toEqual([bot!.id]);
    expect(await db.$count(botConnections)).toBe(1);
  }, 30_000);

  it("gives a new connection to every bot, a bot shared with a guest included, and defers its tools", async () => {
    const app = buildApp();
    const [ops] = await db
      .insert(bots)
      .values({ name: "Ops", modelId: "m", conversationId: "952" })
      .returning();
    const [shared] = await db
      .insert(bots)
      .values({ name: "Shared", modelId: "m", conversationId: "953" })
      .returning();
    await db.insert(users).values({ id: 990_952, email: "conn-guest@example.com", password: "!" });
    await db.insert(guests).values({ userId: 990_952 });
    await db.insert(botGuests).values({ botId: shared!.id, userId: 990_952 });
    configured = [];

    const created = await call(app, "/api/v1/connections", 201, {
      method: "POST",
      json: {
        name: "Demo",
        url: mcpServer.url,
        authType: "header",
        headerName: "x-api-key",
        secret: "secret123",
      },
    });
    expect(created.data).toMatchObject({ allBots: true });
    expect([...created.data.botIds].sort()).toEqual([ops!.id, shared!.id].sort());
    await until(() => configured.includes(952) && configured.includes(953), "bots reconfigured");
    const capability = installed.get("mcp:demo") as unknown as {
      extension: { tools: { deferred?: boolean }[] };
    };
    expect(capability.extension.tools.every((tool) => tool.deferred === true)).toBe(true);
    const opsBot = await call(app, `/api/v1/bots/${ops!.id}`, 200);
    expect(opsBot.data.connectionIds).toEqual([created.data.id]);
    const sharedBot = await call(app, `/api/v1/bots/${shared!.id}`, 200);
    expect(sharedBot.data.connectionIds).toEqual([created.data.id]);
    expect(await db.$count(botConnections)).toBe(0);
    await db.delete(users).where(eq(users.id, 990_952));
  }, 30_000);

  it("shows a tool's schema and turns it off for every bot", async () => {
    const app = buildApp();
    const [bot] = await db
      .insert(bots)
      .values({ name: "Ops", modelId: "m", conversationId: "951" })
      .returning();
    const created = await call(app, "/api/v1/connections", 201, {
      method: "POST",
      json: {
        name: "Demo",
        url: mcpServer.url,
        authType: "header",
        headerName: "x-api-key",
        secret: "secret123",
        botIds: [bot!.id],
      },
    });
    const id = created.data.id;
    expect(created.data.tools[0]).toMatchObject({
      name: "mcp__demo__echo",
      serverName: "echo",
      enabled: true,
    });

    const detail = await call(app, `/api/v1/connections/${id}/tools/echo`, 200);
    expect(detail.data).toMatchObject({
      name: "mcp__demo__echo",
      readOnly: true,
      enabled: true,
      connection: { id, slug: "demo", status: "connected" },
    });
    expect(detail.data.inputSchema.properties).toHaveProperty("value");
    await call(app, `/api/v1/connections/${id}/tools/nope`, 404);

    configured = [];
    const off = await call(app, `/api/v1/connections/${id}/tools/echo`, 200, {
      method: "PATCH",
      json: { enabled: false },
    });
    expect(off.data.enabled).toBe(false);
    expect(installed.get("mcp:demo")!.tools.map((t) => t.name)).toEqual(["mcp__demo__reset"]);
    expect(configured).toContain(951);
    const listed = await call(app, `/api/v1/connections/${id}`, 200);
    expect(
      listed.data.tools.map((t: { serverName: string; enabled: boolean }) => [
        t.serverName,
        t.enabled,
      ]),
    ).toEqual([
      ["echo", false],
      ["reset", true],
    ]);

    await call(app, `/api/v1/connections/${id}/reconnect`, 200, { method: "POST" });
    expect(installed.get("mcp:demo")!.tools.map((t) => t.name)).toEqual(["mcp__demo__reset"]);

    await call(app, `/api/v1/connections/${id}/tools/echo`, 200, {
      method: "PATCH",
      json: { enabled: true },
    });
    expect(installed.get("mcp:demo")!.tools.map((t) => t.name)).toEqual([
      "mcp__demo__echo",
      "mcp__demo__reset",
    ]);
  }, 30_000);

  it("calls a tool from the playground, even one turned off for bots", async () => {
    const app = buildApp();
    const created = await call(app, "/api/v1/connections", 201, {
      method: "POST",
      json: {
        name: "Demo",
        url: mcpServer.url,
        authType: "header",
        headerName: "x-api-key",
        secret: "secret123",
      },
    });
    const id = created.data.id;
    await call(app, `/api/v1/connections/${id}/tools/echo`, 200, {
      method: "PATCH",
      json: { enabled: false },
    });
    const called = await call(app, `/api/v1/connections/${id}/tools/echo/call`, 200, {
      method: "POST",
      json: { arguments: { value: "hi" } },
    });
    expect(called.data.result.content).toEqual([{ type: "text", text: "echo:hi" }]);
    expect(typeof called.data.durationMs).toBe("number");
    await call(app, `/api/v1/connections/${id}/tools/nope/call`, 404, {
      method: "POST",
      json: {},
    });
  }, 30_000);

  it("connects at start() from the database (boot path)", async () => {
    const app = buildApp();
    await call(app, "/api/v1/connections", 201, {
      method: "POST",
      json: {
        name: "Demo",
        url: mcpServer.url,
        authType: "header",
        headerName: "x-api-key",
        secret: "secret123",
      },
    });
    const fresh = new ConnectionManager();
    const installed: string[] = [];
    await fresh.start({
      installCapability: (capability: { id: string }) => installed.push(capability.id),
      uninstallCapability: () => undefined,
      configure: async () => undefined,
      catalog: fakeCatalog(),
    } as never);
    try {
      await until(
        async () =>
          fresh.status((await db.query.connections.findFirst())!.id).status === "connected",
        "the boot connect",
        15_000,
      );
      expect(installed).toContain("mcp:demo");
    } finally {
      await fresh.close();
    }
  }, 30_000);

  it("removes a connection and cleans up", async () => {
    const app = buildApp();
    const created = await call(app, "/api/v1/connections", 201, {
      method: "POST",
      json: {
        name: "Demo",
        url: mcpServer.url,
        authType: "header",
        headerName: "x-api-key",
        secret: "secret123",
      },
    });
    const removed = await call(app, `/api/v1/connections/${created.data.id}`, 200, {
      method: "DELETE",
    });
    expect(removed.data).toEqual({ deleted: true });
    expect(await db.$count(connections)).toBe(0);
    expect(runtimeCalls.uninstall).toContain("mcp:demo");
  }, 30_000);
});

describe("MCP connection lifecycle (the manager owns it)", () => {
  let mcpServer: TestMcpServer;
  let manager: ConnectionManager;
  let runtimeCalls: { install: string[]; uninstall: string[] };
  let configured: number[];
  let changes: string[];

  async function startManager(server: TestMcpServer) {
    mcpServer = server;
    runtimeCalls = { install: [], uninstall: [] };
    configured = [];
    changes = [];
    useTestRuntime({
      configure: async () => undefined,
      catalog: fakeCatalog(),
      installCapability: () => undefined,
      uninstallCapability: () => undefined,
    } as never);
    manager = new ConnectionManager();
    setConnectionManagerForTests(manager);
    manager.onChange((_id, state) => changes.push(state.status));
    await manager.start({
      installCapability: (capability: { id: string }) => runtimeCalls.install.push(capability.id),
      uninstallCapability: (id: string) => runtimeCalls.uninstall.push(id),
      configure: async (conversationId: number) => void configured.push(conversationId),
      catalog: fakeCatalog(),
    } as never);
  }

  beforeEach(async () => {
    await db.delete(botConnections);
    await db.delete(connections);
    await db.delete(bots);
    await startManager(await startMcpServer());
  });

  afterEach(async () => {
    await manager.close();
    setConnectionManagerForTests(undefined);
    useTestRuntime(undefined);
    await new Promise<void>((resolve) => mcpServer.server.close(() => resolve()));
    await db.delete(botConnections);
    await db.delete(connections);
    await db.delete(bots);
    await db.delete(vaultAuditEvents);
    await db.delete(vaultItems);
    await db.delete(vaultValues);
  });

  const createDemo = (app: TestApp, extra: Record<string, unknown> = {}) =>
    call(app, "/api/v1/connections", 201, {
      method: "POST",
      json: { ...DEMO, url: mcpServer.url, ...extra },
    });

  it("a row change during a connect supersedes it: the old attempt's result is dropped", async () => {
    const app = buildApp();
    const created = await createDemo(app);
    const id = created.data.id;
    expect(created.data.status).toBe("connected");

    mcpServer.delayMs = 800;
    void manager.rowChanged(id, 0);
    await sleep(20);
    mcpServer.delayMs = 0;
    const patched = await call(app, `/api/v1/connections/${id}`, 200, {
      method: "PATCH",
      json: { secret: "wrong" },
    });
    expect(patched.data.status).toBe("error");
    await sleep(1_200);
    expect(manager.status(id).status).toBe("error");
  }, 30_000);

  it("removing a connection cancels its connect attempt and never brings it back", async () => {
    const app = buildApp();
    const created = await createDemo(app);
    const id = created.data.id;
    const installsBefore = runtimeCalls.install.length;

    mcpServer.delayMs = 800;
    void manager.rowChanged(id, 0);
    await sleep(20);
    await call(app, `/api/v1/connections/${id}`, 200, { method: "DELETE" });
    expect(runtimeCalls.uninstall).toContain("mcp:demo");
    changes = [];
    mcpServer.delayMs = 0;
    await sleep(1_200);
    expect(manager.status(id)).toEqual({ status: "connecting" });
    expect(runtimeCalls.install.length).toBe(installsBefore);
    expect(changes).toEqual([]);
  }, 30_000);

  it("creating a connection with bots Reconciles each bot once", async () => {
    const app = buildApp();
    const [bot] = await db
      .insert(bots)
      .values({ name: "Ops", modelId: "m", conversationId: "960" })
      .returning();
    await createDemo(app, { botIds: [bot!.id] });
    expect(configured.filter((c) => c === 960)).toHaveLength(1);
  }, 30_000);

  it("leaves tool_search to the runtime, however large its connections are", async () => {
    await new Promise<void>((resolve) => mcpServer.server.close(() => resolve()));
    await manager.close();
    await startManager(await startMcpServer(300));
    const app = buildApp();
    const big = await createDemo(app, { name: "Big one" });
    await call(app, `/api/v1/connections/${big.data.id}`, 200, { method: "DELETE" });
    expect(runtimeCalls.install).not.toContain("tool-search");
    expect(runtimeCalls.uninstall).not.toContain("tool-search");
  }, 30_000);
});

async function startFakeOAuth() {
  const authApp = new Hono();
  authApp.get("/.well-known/oauth-authorization-server", (c) =>
    c.json({
      issuer: `http://127.0.0.1:${authPort}`,
      authorization_endpoint: `http://127.0.0.1:${authPort}/authorize`,
      token_endpoint: `http://127.0.0.1:${authPort}/token`,
      registration_endpoint: `http://127.0.0.1:${authPort}/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
    }),
  );
  authApp.post("/register", (c) =>
    c.json({
      client_id: "client-1",
      client_name: "tiny-agents",
      redirect_uris: [
        `${process.env.ORIGIN ?? "http://localhost:3000"}/api/v1/connections/oauth/callback`,
      ],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  );
  const tokensIssued: Record<string, string> = {};
  authApp.post("/token", async (c) => {
    const body = await c.req.parseBody();
    if (body.grant_type === "authorization_code") {
      tokensIssued.client = String(body.code);
      return c.json({
        access_token: `at-${String(body.code)}`,
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: "rt-1",
      });
    }
    if (body.grant_type === "refresh_token") {
      return c.json({
        access_token: "at-refreshed",
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: "rt-2",
      });
    }
    return c.json({ error: "unsupported_grant_type" }, 400);
  });
  const { server: authServer, port: authPort } = await listen(nodeRequestListener(authApp.fetch));
  expect(authPort).toBeGreaterThan(0);

  const resourceApp = new Hono();
  resourceApp.get("/.well-known/oauth-protected-resource", (c) =>
    c.json({
      resource: `http://127.0.0.1:${resourcePort}/mcp`,
      authorization_servers: [`http://127.0.0.1:${authPort}`],
    }),
  );
  resourceApp.post("/mcp", (c) => {
    c.header(
      "WWW-Authenticate",
      `Bearer resource_metadata="http://127.0.0.1:${resourcePort}/.well-known/oauth-protected-resource"`,
    );
    return c.json(
      { jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null },
      401,
    );
  });
  const { server: resourceServer, port: resourcePort } = await listen(
    nodeRequestListener(resourceApp.fetch),
  );
  const url = `http://127.0.0.1:${resourcePort}/mcp`;
  return {
    url,
    close: async () => {
      await new Promise<void>((resolve) => resourceServer.close(() => resolve()));
      await new Promise<void>((resolve) => authServer.close(() => resolve()));
    },
  };
}

async function startOAuthManager() {
  const manager = new ConnectionManager();
  setConnectionManagerForTests(manager);
  const uninstalled: string[] = [];
  const runtime = {
    installCapability: () => undefined,
    uninstallCapability: (id: string) => uninstalled.push(id),
    configure: async () => undefined,
    catalog: fakeCatalog(),
  } as never;
  await manager.start(runtime);
  return { manager, uninstalled };
}

describe("MCP OAuth (fake authorization server)", () => {
  it("marks a 401 as needs_auth, and finishAuthorization exchanges the code", async () => {
    await db.delete(botConnections);
    await db.delete(connections);

    const fake = await startFakeOAuth();
    const url = fake.url;

    const { manager, uninstalled } = await startOAuthManager();

    try {
      const row = (
        await db
          .insert(connections)
          .values({ name: "Locked", slug: "locked", url, authType: "oauth" })
          .returning()
      )[0]!;
      const consent = await manager.authorize(row.id);
      expect(consent).toContain("authorize");
      await manager.connect(row.id);
      expect(manager.status(row.id).status).toBe("needs_auth");
      expect(uninstalled).toContain("mcp:locked");

      const state = decodeURIComponent(new URL(consent!).searchParams.get("state")!);
      const id = await manager.finishAuthorization(state, "the-code");
      expect(id).toBe(row.id);
      expect(await manager.hasTokens(row.id)).toBe(true);

      const second = (
        await db
          .insert(connections)
          .values({ name: "Redirect", slug: "redirect", url, authType: "oauth" })
          .returning()
      )[0]!;
      const consent2 = await manager.authorize(second.id);
      expect(consent2).toContain("authorize");
      const state2 = decodeURIComponent(new URL(consent2!).searchParams.get("state")!);
      const app = buildApp();
      const query = new URLSearchParams({
        code: "route-code",
        state: state2,
        iss: "https://executor.sh/api/auth",
      });
      const res = await app.request(`/api/v1/connections/oauth/callback?${query}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/^text\/html/);
      const text = await res.text();
      expect(text).toContain(`"id":"${second.id}"`);
      expect(text).not.toContain("error");
      expect(await manager.hasTokens(second.id)).toBe(true);
    } finally {
      await manager.close();
      setConnectionManagerForTests(undefined);
      await fake.close();
      await db.delete(connections);
    }
  }, 30_000);

  it("a sign-in stored in the old v1 format asks to sign in again, and signing in replaces it", async () => {
    await db.delete(botConnections);
    await db.delete(connections);
    const fake = await startFakeOAuth();
    const { manager, uninstalled } = await startOAuthManager();
    try {
      const row = (
        await db
          .insert(connections)
          .values({
            name: "Old",
            slug: "old",
            url: fake.url,
            authType: "oauth",
            oauthEnc: "v1:aXZpdml2aXZpdg==:dGFndGFndGFn:Y2lwaGVy",
          })
          .returning()
      )[0]!;

      await manager.connect(row.id);
      expect(manager.status(row.id)).toEqual({
        status: "needs_auth",
        error: "The saved sign-in can't be read anymore. Sign in again.",
      });
      expect(uninstalled).toContain("mcp:old");

      const consent = await manager.authorize(row.id);
      expect(consent).toContain("/authorize");
      const state = decodeURIComponent(new URL(consent!).searchParams.get("state")!);
      expect(await manager.finishAuthorization(state, "fresh-code")).toBe(row.id);
      expect(await manager.hasTokens(row.id)).toBe(true);
    } finally {
      await manager.close();
      setConnectionManagerForTests(undefined);
      await fake.close();
      await db.delete(connections);
    }
  }, 30_000);
});

describe("MCP OAuth callback guard", () => {
  it("completes once, then refuses a replay of the same state", async () => {
    await db.delete(botConnections);
    await db.delete(connections);
    const fake = await startFakeOAuth();
    const { manager } = await startOAuthManager();
    try {
      const row = (
        await db
          .insert(connections)
          .values({ name: "Once", slug: "once", url: fake.url, authType: "oauth" })
          .returning()
      )[0]!;
      const consent = await manager.authorize(row.id);
      const state = decodeURIComponent(new URL(consent!).searchParams.get("state")!);
      const app = buildApp();
      const query = new URLSearchParams({ code: "code-1", state });
      const first = await app.request(`/api/v1/connections/oauth/callback?${query}`);
      expect(first.status).toBe(200);
      expect(await manager.hasTokens(row.id)).toBe(true);

      const replay = await app.request(
        `/api/v1/connections/oauth/callback?${new URLSearchParams({ code: "code-2", state })}`,
      );
      expect(replay.status).toBe(200);
      const text = await replay.text();
      expect(text).toContain("error");
      expect(text).not.toContain(`"id"`);
      expect((await readOAuthState(row.id)).state).toBeUndefined();
      expect((await readOAuthState(row.id)).userId).toBeUndefined();
    } finally {
      await manager.close();
      setConnectionManagerForTests(undefined);
      await fake.close();
      await db.delete(connections);
    }
  }, 30_000);

  it("refuses a state bound to another user's session", async () => {
    await db.delete(botConnections);
    await db.delete(connections);
    const fake = await startFakeOAuth();
    const { manager } = await startOAuthManager();
    try {
      const row = (
        await db
          .insert(connections)
          .values({ name: "Bound", slug: "bound", url: fake.url, authType: "oauth" })
          .returning()
      )[0]!;
      const consent = await manager.authorize(row.id, 1);
      const state = decodeURIComponent(new URL(consent!).searchParams.get("state")!);
      const app = buildApp();
      const query = new URLSearchParams({ code: "code-1", state });
      const stranger = await app.request(`/api/v1/connections/oauth/callback?${query}`, {
        headers: { authorization: `Bearer ${await authToken("stranger@example.com", 2)}` },
      });
      expect(stranger.status).toBe(200);
      expect(await stranger.text()).toContain("error");
      expect(await manager.hasTokens(row.id)).toBe(false);
    } finally {
      await manager.close();
      setConnectionManagerForTests(undefined);
      await fake.close();
      await db.delete(connections);
    }
  }, 30_000);

  it("refuses a state older than ten minutes", async () => {
    await db.delete(botConnections);
    await db.delete(connections);
    const fake = await startFakeOAuth();
    const { manager } = await startOAuthManager();
    try {
      const row = (
        await db
          .insert(connections)
          .values({ name: "Stale", slug: "stale", url: fake.url, authType: "oauth" })
          .returning()
      )[0]!;
      const consent = await manager.authorize(row.id);
      const state = decodeURIComponent(new URL(consent!).searchParams.get("state")!);
      vi.setSystemTime(Date.now() + 11 * 60_000);
      const app = buildApp();
      const query = new URLSearchParams({ code: "code-1", state });
      const stale = await app.request(`/api/v1/connections/oauth/callback?${query}`);
      expect(stale.status).toBe(200);
      expect(await stale.text()).toContain("expired");
      expect(await manager.hasTokens(row.id)).toBe(false);
    } finally {
      vi.setSystemTime(Date.parse(FIXED_NOW));
      await manager.close();
      setConnectionManagerForTests(undefined);
      await fake.close();
      await db.delete(connections);
    }
  }, 30_000);

  it("rate-limits the public callback", async () => {
    await db.delete(botConnections);
    await db.delete(connections);
    const fake = await startFakeOAuth();
    const { manager } = await startOAuthManager();
    try {
      const app = createTestApp({ rateLimitStore: memoryRateLimitStore() });
      const statuses: number[] = [];
      for (let i = 0; i < 22; i++) {
        const response = await app.request(
          `/api/v1/connections/oauth/callback?${new URLSearchParams({ code: "x", state: "none" })}`,
        );
        statuses.push(response.status);
      }
      expect(statuses.slice(0, 20)).toEqual(Array.from({ length: 20 }, () => 200));
      expect(statuses.slice(20)).toEqual([429, 429]);
      expect(await manager.hasTokens("none")).toBe(false);
    } finally {
      await manager.close();
      setConnectionManagerForTests(undefined);
      await fake.close();
      await db.delete(connections);
    }
  }, 30_000);
});
