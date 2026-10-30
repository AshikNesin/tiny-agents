/**
 * MCP connections end to end (issue #1 M3): a real Streamable HTTP MCP server
 * on localhost with header auth, CRUD through the API, the manager's live
 * state and re-install on tool changes, and the OAuth flow against a fake
 * authorization server.
 */
import { createServer, type IncomingMessage, type RequestListener, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { getRequestListener } from "@hono/node-server";
import { Hono } from "hono";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";
import { z } from "zod";
import { generateToken } from "@groot/core/utils/jwt.utils";
import { botConnections, bots, connections, db } from "../../../apps/web/src/server/db";
import { McpServer, StreamableHTTPServerTransport } from "../../../packages/agent/src/testing";
import {
  ConnectionManager,
  setConnectionManagerForTests,
} from "../../../apps/web/src/server/api/connections/connections.manager";
import { setAgentRuntimeForTests } from "../../../apps/web/src/server/api/bots/bots.runtime";
import { api, createTestApp, type TestApp } from "../helpers";

let token: string;
beforeAll(async () => {
  token = await generateToken({ userId: 1, email: "mcp@example.com" });
});

const buildApp = (): TestApp => createTestApp();

// oxlint-disable-next-line typescript/no-explicit-any -- response data varies per route
type Data = any;

/** An authenticated JSON request that must answer `status`; returns the envelope. */
async function call(
  app: TestApp,
  path: string,
  status: number,
  init: { method?: string; json?: unknown } = {},
) {
  const response = await api<Data>(app, path, {
    method: init.method ?? "GET",
    token,
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
}

function buildMcp(name: string) {
  const mcp = new McpServer({ name, version: "1.0.0" });
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

/** Stateless Streamable HTTP MCP server requiring `x-api-key: secret123`. */
async function startMcpServer(): Promise<TestMcpServer> {
  const tokens = new Set<string>(["secret123"]);
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
    // Stateless: one server+transport per request, closed with the response.
    const mcp = buildMcp("demo-mcp");
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => void transport.close().catch(() => undefined));
    await mcp.connect(transport);
    await transport.handleRequest(req, res, await readJson(req));
  });
  return { url: `http://127.0.0.1:${port}/mcp`, server, tokens };
}

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
    setAgentRuntimeForTests({
      configure: async () => undefined,
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
    } as never);
  });

  afterEach(async () => {
    await manager.close();
    setConnectionManagerForTests(undefined);
    setAgentRuntimeForTests(undefined as never);
    await new Promise<void>((resolve) => mcpServer.server.close(() => resolve()));
    await db.delete(botConnections);
    await db.delete(connections);
    await db.delete(bots);
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

    // A bad secret is reported, not thrown away silently.
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

    // Reconnecting (a fresh tool listing) keeps it off.
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
    // A second manager, like a fresh boot: connects from rows alone.
    const fresh = new ConnectionManager();
    const installed: string[] = [];
    await fresh.start({
      installCapability: (capability: { id: string }) => installed.push(capability.id),
      uninstallCapability: () => undefined,
      configure: async () => undefined,
    } as never);
    try {
      const deadline = Date.now() + 15_000;
      while (fresh.status((await db.query.connections.findFirst())!.id).status !== "connected") {
        if (Date.now() > deadline) throw new Error("boot connect timed out");
        await new Promise((r) => setTimeout(r, 50));
      }
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

describe("MCP OAuth (fake authorization server)", () => {
  it("marks a 401 as needs_auth, and finishAuthorization exchanges the code", async () => {
    await db.delete(botConnections);
    await db.delete(connections);

    // Minimal OAuth pieces: discovery, registration, token.
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
    const { server: authServer, port: authPort } = await listen(getRequestListener(authApp.fetch));
    expect(authPort).toBeGreaterThan(0);

    // A server URL whose discovery points at the fake AS and always 401s
    // without a token; accept-token requests hit the AS's token endpoint only.
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
      getRequestListener(resourceApp.fetch),
    );
    const url = `http://127.0.0.1:${resourcePort}/mcp`;

    const manager = new ConnectionManager();
    setConnectionManagerForTests(manager);
    const uninstalled: string[] = [];
    const runtime = {
      installCapability: () => undefined,
      uninstallCapability: (id: string) => uninstalled.push(id),
      configure: async () => undefined,
    } as never;
    await manager.start(runtime);

    try {
      const row = (
        await db
          .insert(connections)
          .values({ name: "Locked", slug: "locked", url, authType: "oauth" })
          .returning()
      )[0]!;
      // authorize() runs discovery + registration and captures the consent URL.
      const consent = await manager.authorize(row.id);
      expect(consent).toContain("authorize");
      // The connection itself reports needs_auth until the code comes back.
      await manager.connect(row.id);
      expect(manager.status(row.id).status).toBe("needs_auth");
      expect(uninstalled).toContain("mcp:locked");

      const state = decodeURIComponent(new URL(consent!).searchParams.get("state")!);
      const id = await manager.finishAuthorization(state, "the-code");
      expect(id).toBe(row.id);
      expect(await manager.hasTokens(row.id)).toBe(true);

      // The browser returns from the authorization server as a cross-site
      // redirect: no session cookie, no Authorization header. The callback
      // route must still complete the exchange (regression: it used to sit
      // behind jwtAuthMiddleware and failed with UNAUTHORIZED "No token
      // provided").
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
      await new Promise<void>((resolve) => resourceServer.close(() => resolve()));
      await new Promise<void>((resolve) => authServer.close(() => resolve()));
      await db.delete(connections);
    }
  }, 30_000);
});
