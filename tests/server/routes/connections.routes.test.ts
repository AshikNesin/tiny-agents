/**
 * MCP connections end to end (issue #1 M3): a real Streamable HTTP MCP server
 * on localhost with header auth, CRUD through the API, the manager's live
 * state and re-install on tool changes, and the OAuth flow against a fake
 * authorization server.
 */
import express, { type Express } from "express";
import request from "supertest";
import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { z } from "zod";
import { prisma } from "@groot/core/database";
import { errorHandlerMiddleware } from "@groot/core/middlewares/error-handler.middleware";
import { generateToken } from "@groot/core/utils/jwt.utils";
import { registerRoutes } from "../../../apps/web/src/server/routes";
import { McpServer, StreamableHTTPServerTransport } from "../../../packages/agent/src/testing";
import {
  ConnectionManager,
  setConnectionManagerForTests,
} from "../../../apps/web/src/server/api/connections/connections.manager";
import { setAgentRuntimeForTests } from "../../../apps/web/src/server/api/bots/bots.runtime";

const authorization = {
  Authorization: `Bearer ${generateToken({ userId: 1, email: "mcp@example.com" })}`,
};

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  registerRoutes(app);
  app.use(errorHandlerMiddleware);
  return app;
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
  const app = express();
  app.use(express.json({ limit: "4mb" }));
  app.post("/mcp", async (req, res) => {
    if (!tokens.has(req.get("x-api-key") ?? "")) {
      res
        .status(401)
        .json({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null });
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
    await transport.handleRequest(req, res, req.body);
  });
  app.get("/mcp", (_req, res) => res.status(405).end());
  app.delete("/mcp", (_req, res) => res.status(405).end());

  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    url: `http://127.0.0.1:${typeof address === "object" ? address.port : 0}/mcp`,
    server,
    tokens,
  };
}

describe("MCP connections (header auth, streamable http)", () => {
  let mcpServer: TestMcpServer;
  let manager: ConnectionManager;
  let runtimeCalls: { install: string[]; uninstall: string[] };
  let installed: Map<string, { tools: { name: string }[] }>;
  let configured: number[];

  beforeEach(async () => {
    await prisma.botConnection.deleteMany();
    await prisma.connection.deleteMany();
    await prisma.bot.deleteMany();
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
    await prisma.botConnection.deleteMany();
    await prisma.connection.deleteMany();
    await prisma.bot.deleteMany();
  });

  it("tests a server, saves it connected, and lists its tools", async () => {
    const app = buildApp();
    const test = await request(app)
      .post("/api/v1/connections/test")
      .set(authorization)
      .send({ url: mcpServer.url, headerName: "x-api-key", secret: "secret123" })
      .expect(200);
    expect(
      test.body.data.tools.map((t: { name: string; readOnly: boolean }) => [t.name, t.readOnly]),
    ).toEqual([
      ["echo", true],
      ["reset", false],
    ]);
    await request(app)
      .post("/api/v1/connections/test")
      .set(authorization)
      .send({ url: mcpServer.url })
      .expect(400);

    const created = await request(app)
      .post("/api/v1/connections")
      .set(authorization)
      .send({
        name: "Demo",
        url: mcpServer.url,
        authType: "header",
        headerName: "x-api-key",
        secret: "secret123",
      })
      .expect(201);
    expect(created.body.data).toMatchObject({
      status: "connected",
      slug: "demo",
      authType: "header",
    });
    expect(created.body.data.tools.map((t: { name: string }) => t.name)).toEqual([
      "mcp__demo__echo",
      "mcp__demo__reset",
    ]);
    expect(runtimeCalls.install).toContain("mcp:demo");
    expect(created.body.data).not.toHaveProperty("secret");

    // A bad secret is reported, not thrown away silently.
    const bad = await request(app)
      .post("/api/v1/connections")
      .set(authorization)
      .send({
        name: "Bad",
        url: mcpServer.url,
        authType: "header",
        headerName: "x-api-key",
        secret: "wrong",
      })
      .expect(201);
    expect(bad.body.data.status).toBe("error");
  }, 30_000);

  it("enables a connection for a bot and re-applies its capability config", async () => {
    const app = buildApp();
    const bot = await prisma.bot.create({
      data: { name: "Ops", modelId: "m", conversationId: "950" },
    });
    const created = await request(app)
      .post("/api/v1/connections")
      .set(authorization)
      .send({
        name: "Demo",
        url: mcpServer.url,
        authType: "header",
        headerName: "x-api-key",
        secret: "secret123",
        botIds: [bot.id],
      })
      .expect(201);
    const patched = await request(app)
      .patch(`/api/v1/bots/${bot.id}`)
      .set(authorization)
      .send({ connectionIds: [] })
      .expect(200);
    expect(patched.body.data.connectionIds).toEqual([]);
    await request(app)
      .patch(`/api/v1/connections/${created.body.data.id}`)
      .set(authorization)
      .send({ botIds: [bot.id] })
      .expect(200);
    const detail = await request(app)
      .get(`/api/v1/connections/${created.body.data.id}`)
      .set(authorization)
      .expect(200);
    expect(detail.body.data.botIds).toEqual([bot.id]);
    expect(await prisma.botConnection.count()).toBe(1);
  }, 30_000);

  it("shows a tool's schema and turns it off for every bot", async () => {
    const app = buildApp();
    const bot = await prisma.bot.create({
      data: { name: "Ops", modelId: "m", conversationId: "951" },
    });
    const created = await request(app)
      .post("/api/v1/connections")
      .set(authorization)
      .send({
        name: "Demo",
        url: mcpServer.url,
        authType: "header",
        headerName: "x-api-key",
        secret: "secret123",
        botIds: [bot.id],
      })
      .expect(201);
    const id = created.body.data.id;
    expect(created.body.data.tools[0]).toMatchObject({
      name: "mcp__demo__echo",
      serverName: "echo",
      enabled: true,
    });

    const detail = await request(app)
      .get(`/api/v1/connections/${id}/tools/echo`)
      .set(authorization)
      .expect(200);
    expect(detail.body.data).toMatchObject({
      name: "mcp__demo__echo",
      readOnly: true,
      enabled: true,
      connection: { id, slug: "demo", status: "connected" },
    });
    expect(detail.body.data.inputSchema.properties).toHaveProperty("value");
    await request(app).get(`/api/v1/connections/${id}/tools/nope`).set(authorization).expect(404);

    configured = [];
    const off = await request(app)
      .patch(`/api/v1/connections/${id}/tools/echo`)
      .set(authorization)
      .send({ enabled: false })
      .expect(200);
    expect(off.body.data.enabled).toBe(false);
    expect(installed.get("mcp:demo")!.tools.map((t) => t.name)).toEqual(["mcp__demo__reset"]);
    expect(configured).toContain(951);
    const listed = await request(app).get(`/api/v1/connections/${id}`).set(authorization);
    expect(
      listed.body.data.tools.map((t: { serverName: string; enabled: boolean }) => [
        t.serverName,
        t.enabled,
      ]),
    ).toEqual([
      ["echo", false],
      ["reset", true],
    ]);

    // Reconnecting (a fresh tool listing) keeps it off.
    await request(app).post(`/api/v1/connections/${id}/reconnect`).set(authorization).expect(200);
    expect(installed.get("mcp:demo")!.tools.map((t) => t.name)).toEqual(["mcp__demo__reset"]);

    await request(app)
      .patch(`/api/v1/connections/${id}/tools/echo`)
      .set(authorization)
      .send({ enabled: true })
      .expect(200);
    expect(installed.get("mcp:demo")!.tools.map((t) => t.name)).toEqual([
      "mcp__demo__echo",
      "mcp__demo__reset",
    ]);
  }, 30_000);

  it("calls a tool from the playground, even one turned off for bots", async () => {
    const app = buildApp();
    const created = await request(app)
      .post("/api/v1/connections")
      .set(authorization)
      .send({
        name: "Demo",
        url: mcpServer.url,
        authType: "header",
        headerName: "x-api-key",
        secret: "secret123",
      })
      .expect(201);
    const id = created.body.data.id;
    await request(app)
      .patch(`/api/v1/connections/${id}/tools/echo`)
      .set(authorization)
      .send({ enabled: false })
      .expect(200);
    const called = await request(app)
      .post(`/api/v1/connections/${id}/tools/echo/call`)
      .set(authorization)
      .send({ arguments: { value: "hi" } })
      .expect(200);
    expect(called.body.data.result.content).toEqual([{ type: "text", text: "echo:hi" }]);
    expect(typeof called.body.data.durationMs).toBe("number");
    await request(app)
      .post(`/api/v1/connections/${id}/tools/nope/call`)
      .set(authorization)
      .send({})
      .expect(404);
  }, 30_000);

  it("connects at start() from the database (boot path)", async () => {
    const app = buildApp();
    await request(app)
      .post("/api/v1/connections")
      .set(authorization)
      .send({
        name: "Demo",
        url: mcpServer.url,
        authType: "header",
        headerName: "x-api-key",
        secret: "secret123",
      })
      .expect(201);
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
      while (fresh.status((await prisma.connection.findFirst())!.id).status !== "connected") {
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
    const created = await request(app)
      .post("/api/v1/connections")
      .set(authorization)
      .send({
        name: "Demo",
        url: mcpServer.url,
        authType: "header",
        headerName: "x-api-key",
        secret: "secret123",
      })
      .expect(201);
    await request(app)
      .delete(`/api/v1/connections/${created.body.data.id}`)
      .set(authorization)
      .expect(200);
    expect(await prisma.connection.count()).toBe(0);
    expect(runtimeCalls.uninstall).toContain("mcp:demo");
  }, 30_000);
});

describe("MCP OAuth (fake authorization server)", () => {
  it("marks a 401 as needs_auth, and finishAuthorization exchanges the code", async () => {
    await prisma.botConnection.deleteMany();
    await prisma.connection.deleteMany();

    // Minimal OAuth pieces: discovery, registration, token.
    const authApp = express();
    authApp.use(express.json());
    authApp.use(express.urlencoded({ extended: false }));
    authApp.get("/.well-known/oauth-authorization-server", (_req, res) =>
      res.json({
        issuer: `http://127.0.0.1:${authPort}`,
        authorization_endpoint: `http://127.0.0.1:${authPort}/authorize`,
        token_endpoint: `http://127.0.0.1:${authPort}/token`,
        registration_endpoint: `http://127.0.0.1:${authPort}/register`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
      }),
    );
    authApp.post("/register", (_req, res) =>
      res.json({
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
    authApp.post("/token", (req, res) => {
      const body = req.body ?? {};
      if (body.grant_type === "authorization_code") {
        tokensIssued.client = String(body.code);
        res.json({
          access_token: `at-${body.code}`,
          token_type: "Bearer",
          expires_in: 3600,
          refresh_token: "rt-1",
        });
      } else if (body.grant_type === "refresh_token") {
        res.json({
          access_token: "at-refreshed",
          token_type: "Bearer",
          expires_in: 3600,
          refresh_token: "rt-2",
        });
      } else {
        res.status(400).json({ error: "unsupported_grant_type" });
      }
    });
    const authServer = createServer(authApp);
    await new Promise<void>((resolve) => authServer.listen(0, "127.0.0.1", resolve));
    const authAddress = authServer.address();
    const authPort = typeof authAddress === "object" ? authAddress.port : 0;
    expect(authPort).toBeGreaterThan(0);

    // A server URL whose discovery points at the fake AS and always 401s
    // without a token; accept-token requests hit the AS's token endpoint only.
    const resourceApp = express();
    resourceApp.get("/.well-known/oauth-protected-resource", (_req, res) =>
      res.json({
        resource: `http://127.0.0.1:${resourcePort}/mcp`,
        authorization_servers: [`http://127.0.0.1:${authPort}`],
      }),
    );
    resourceApp.post("/mcp", (_req, res) => {
      res
        .status(401)
        .set(
          "WWW-Authenticate",
          `Bearer resource_metadata="http://127.0.0.1:${resourcePort}/.well-known/oauth-protected-resource"`,
        )
        .json({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null });
    });
    const resourceServer = createServer(resourceApp);
    await new Promise<void>((resolve) => resourceServer.listen(0, "127.0.0.1", resolve));
    const resourceAddress = resourceServer.address();
    const resourcePort = typeof resourceAddress === "object" ? resourceAddress.port : 0;
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
      const row = await prisma.connection.create({
        data: { name: "Locked", slug: "locked", url, authType: "oauth" },
      });
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
      const second = await prisma.connection.create({
        data: { name: "Redirect", slug: "redirect", url, authType: "oauth" },
      });
      const consent2 = await manager.authorize(second.id);
      expect(consent2).toContain("authorize");
      const state2 = decodeURIComponent(new URL(consent2!).searchParams.get("state")!);
      const app = buildApp();
      const res = await request(app)
        .get("/api/v1/connections/oauth/callback")
        .query({ code: "route-code", state: state2, iss: "https://executor.sh/api/auth" })
        .expect(200);
      expect(res.text).toContain(`"id":"${second.id}"`);
      expect(res.text).not.toContain("error");
      expect(await manager.hasTokens(second.id)).toBe(true);
    } finally {
      await manager.close();
      setConnectionManagerForTests(undefined);
      await new Promise<void>((resolve) => resourceServer.close(() => resolve()));
      await new Promise<void>((resolve) => authServer.close(() => resolve()));
      await prisma.connection.deleteMany();
    }
  }, 30_000);
});
