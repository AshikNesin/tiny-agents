// Feature: connections (features/connections.md). A real MCP server (the SDK the app ships,
// Streamable HTTP on 127.0.0.1, header auth) is started by this journey: add with a failing
// and a passing Test, tools listed and installed, tool on/off, bot links from both sides,
// tool page + playground, reconnect, header value from a vault item, an unreachable
// server under Needs attention, remove.
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { journey, expect, DEMO } from "../scripts/lib.mjs";

// The MCP SDK is a dependency of packages/agent, not of the repo root.
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const sdk = createRequire(path.join(repo, "packages/agent/package.json"));
const load = (spec) => import(pathToFileURL(sdk.resolve(spec)).href);
const { Server } = await load("@modelcontextprotocol/sdk/server/index.js");
const { StreamableHTTPServerTransport } = await load(
  "@modelcontextprotocol/sdk/server/streamableHttp.js",
);
const { ListToolsRequestSchema, CallToolRequestSchema } = await load(
  "@modelcontextprotocol/sdk/types.js",
);

const TOOLS = [
  {
    name: "echo",
    description: "Echo a value back",
    inputSchema: {
      type: "object",
      properties: { value: { type: "string", description: "What to echo" } },
      required: ["value"],
    },
    annotations: { readOnlyHint: true },
  },
  { name: "reset", description: "Reset the counter", inputSchema: { type: "object" } },
];

/** Stateless Streamable HTTP MCP server on a free loopback port; only `keys` get in. */
async function startMcp(keys) {
  const seen = { keys: [], resets: 0 };
  const server = createServer(async (req, res) => {
    if (new URL(req.url ?? "/", "http://x").pathname !== "/mcp") return res.writeHead(404).end();
    if (req.method !== "POST") return res.writeHead(405).end();
    const key = String(req.headers["x-api-key"] ?? "");
    seen.keys.push(key);
    if (!keys.has(key)) {
      res.writeHead(401, { "content-type": "application/json" });
      return res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32001, message: "Unauthorized" },
          id: null,
        }),
      );
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
    const mcp = new Server(
      { name: "verify-mcp", version: "1.0.0" },
      { capabilities: { tools: {} } },
    );
    mcp.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
    mcp.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
      if (params.name === "echo")
        return { content: [{ type: "text", text: `echo:${params.arguments?.value}` }] };
      seen.resets++;
      return { content: [{ type: "text", text: "reset done" }] };
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => void transport.close().catch(() => {}));
    await mcp.connect(transport);
    await transport.handleRequest(req, res, body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    seen,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

/** A loopback port with nothing listening. */
async function deadPort() {
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

await journey("connections", async ({ page, step, proof, cleanup, api, stamp }) => {
  const name = `Verify MCP ${stamp}`;
  const broken = `Verify Broken ${stamp}`;
  const botName = `MCP Bot ${stamp}`;
  const secret = `key-${stamp}-c0nn`;
  const vaultSecret = `vault-${stamp}-c0nn`;
  const handle = `verify-mcp-${stamp}`;
  const keys = new Set([secret]);
  let mcp;
  let botId;
  let id;
  let slug;
  let stepUp;
  const conn = () => api.get(`/connections/${id}`);
  const byName = async (n) => (await api.get("/connections")).find((c) => c.name === n);
  const capability = async () =>
    (await api.get("/capabilities")).capabilities.find((c) => c.id === `mcp:${slug}`);
  const toolNames = (cap) => (cap?.tools ?? []).map((t) => t.name ?? t);
  const removeIfThere = (n) => async () => {
    const row = await byName(n);
    if (row) await api.delete(`/connections/${row.id}`);
  };

  await step("setup: a local MCP server (header x-api-key) and a faux bot (API)", async () => {
    mcp = await startMcp(keys);
    cleanup(() => mcp.close());
    const models = await api.get("/models");
    botId = (await api.post("/bots", { name: botName, modelId: models.defaultModel })).id;
    cleanup(() => api.delete(`/bots/${botId}`));
  });

  await step("open Connections from the account menu", async () => {
    await page.getByRole("button", { name: "Account and navigation" }).click();
    await page.getByRole("menuitem", { name: "Connections" }).click();
    await expect(page).toHaveURL(/\/connections$/);
    await expect(page.getByRole("heading", { name: "Connections", exact: true })).toBeVisible();
  });

  await step("Add connection: header auth with a wrong secret fails the test inline", async () => {
    await page.getByRole("button", { name: "Add connection" }).click();
    const dialog = page.getByRole("dialog", { name: "Add connection" });
    await dialog.getByLabel("Name").fill(name);
    await dialog.getByLabel("URL").fill(mcp.url);
    await dialog.getByRole("combobox", { name: "Authentication type" }).click();
    await page.getByRole("option", { name: "API key or header" }).click();
    await expect(dialog.getByLabel("Header name")).toHaveValue("x-api-key");
    await expect(dialog.getByLabel("Secret")).toHaveAttribute("type", "password");
    await dialog.getByLabel("Secret").fill("wrong-secret");
    await dialog.getByRole("button", { name: "Test connection" }).click();
    await expect(dialog.getByRole("alert")).toContainText("Test failed", { timeout: 20_000 });
    expect(mcp.seen.keys).toContain("wrong-secret");
  });
  await proof("test-failed");

  await step("the right secret passes the test and lists the server's tools", async () => {
    const dialog = page.getByRole("dialog", { name: "Add connection" });
    await dialog.getByLabel("Secret").fill(secret);
    await dialog.getByRole("button", { name: "Test connection" }).click();
    await expect(dialog.getByText("Streamable HTTP · 2 tools found")).toBeVisible({
      timeout: 20_000,
    });
    await expect(dialog.getByText("echo · read-only")).toBeVisible();
    await expect(dialog.getByText("reset", { exact: true })).toBeVisible();
  });
  await proof("test-passed");

  await step("save: detail page connects and lists the tools", async () => {
    await page
      .getByRole("dialog", { name: "Add connection" })
      .getByRole("button", { name: "Save" })
      .click();
    await expect(page.getByText("Connection added")).toBeVisible();
    await expect(page).toHaveURL(/\/connections\/[^/]+$/);
    id = page.url().split("/").pop();
    cleanup(removeIfThere(name));
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    await expect.poll(async () => (await conn()).status, { timeout: 30_000 }).toBe("connected");
    await expect(page.getByText("Connected", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("API key header (x-api-key)", { exact: false })).toBeVisible();
    await expect(page.getByRole("link", { name: /^echo\b/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /^reset\b/ })).toBeVisible();
  });
  await proof("connected");

  await step("secret is write-only; tools are installed as mcp:<slug> for bots", async () => {
    const row = await conn();
    slug = row.slug;
    expect(row.hasSecret).toBe(true);
    expect(row.authType).toBe("header");
    expect(JSON.stringify(row)).not.toContain(secret);
    expect(JSON.stringify(await api.get("/connections"))).not.toContain(secret);
    expect(await page.content()).not.toContain(secret);
    expect(mcp.seen.keys).toContain(secret);
    expect(row.tools.map((t) => t.name).sort()).toEqual(
      [`mcp__${slug}__echo`, `mcp__${slug}__reset`].sort(),
    );
    await expect.poll(async () => toolNames(await capability()).join(",")).toContain("echo");
  });

  await step("turn reset off for every bot from the tools list", async () => {
    const sw = page.getByRole("switch", { name: "Let bots use reset" });
    await expect(sw).toBeChecked();
    await sw.click();
    await expect(sw).not.toBeChecked();
    await expect(page.getByText("2 tools · 1 off")).toBeVisible();
    await expect
      .poll(async () => (await conn()).tools.find((t) => t.serverName === "reset")?.enabled)
      .toBe(false);
    await expect.poll(async () => toolNames(await capability()).join(",")).not.toContain("reset");
    expect(toolNames(await capability()).join(",")).toContain("echo");
  });
  await proof("reset-off");

  await step("Used by bots: tick the bot", async () => {
    const box = page.getByRole("checkbox", { name: `Use ${name} tools in ${botName}` });
    await box.click();
    await expect(box).toBeChecked();
    await expect.poll(async () => (await conn()).botIds).toContain(botId);
    expect((await api.get(`/bots/${botId}`)).connectionIds).toContain(id);
  });

  await step(
    "the bot's Edit dialog shows the connection on; off and on again from there",
    async () => {
      await page.goto(`/chats/${botId}`);
      for (const want of [false, true]) {
        await page.getByRole("button", { name: `${botName} actions` }).click();
        await page.getByRole("menuitem", { name: "Edit bot" }).click();
        const dialog = page.getByRole("dialog", { name: `Edit ${botName}` });
        await dialog.getByRole("tab", { name: "Tools" }).click();
        const sw = dialog.getByRole("switch", { name: `Enable ${name}` });
        await sw.scrollIntoViewIfNeeded();
        await expect(sw).toBeChecked({ checked: !want });
        if (!want) await proof("bot-dialog-connection");
        await sw.click();
        await dialog.getByRole("button", { name: "Save changes" }).click();
        await expect(dialog).not.toBeVisible({ timeout: 15_000 });
        await expect
          .poll(async () => (await api.get(`/bots/${botId}`)).connectionIds.includes(id))
          .toBe(want);
      }
      expect((await conn()).botIds).toContain(botId);
    },
  );

  await step("tool page: echo's schema, Available to bots, playground run", async () => {
    await page.goto(`/connections/${id}`);
    await page.getByRole("link", { name: /^echo\b/ }).click();
    await expect(page).toHaveURL(new RegExp(`/connections/${id}/tools/echo$`));
    await expect(page.getByRole("heading", { name: "echo", exact: true })).toBeVisible();
    await expect(page.getByText(`mcp__${slug}__echo`)).toBeVisible();
    await expect(page.getByRole("switch", { name: "Available to bots" })).toBeChecked();
    await expect(page.getByText("Echo a value back")).toBeVisible();
    await page.getByRole("textbox", { name: /^value/ }).fill(`hi ${stamp}`);
    await page.getByRole("button", { name: "Run tool" }).click();
    await expect(page.getByText("Success", { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(`echo:hi ${stamp}`)).toBeVisible();
  });
  await proof("tool-echo-ran");

  await step("tool page: reset is off for bots, still runs after a confirm", async () => {
    await page.goto(`/connections/${id}/tools/reset`);
    await expect(page.getByText("Off for every bot")).toBeVisible();
    await expect(page.getByRole("switch", { name: "Available to bots" })).not.toBeChecked();
    const before = mcp.seen.resets;
    await page.getByRole("button", { name: "Run tool" }).click();
    const confirm = page.getByRole("dialog", { name: "Run reset?" });
    await expect(confirm).toContainText("may change data");
    await confirm.getByRole("button", { name: "Run", exact: true }).click();
    await expect(page.getByText("Success", { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("reset done")).toBeVisible();
    expect(mcp.seen.resets).toBe(before + 1);
  });
  await proof("tool-reset-ran");

  await step("tool page: turn reset back on for bots", async () => {
    await page.getByRole("switch", { name: "Available to bots" }).click();
    await expect(page.getByText("Bots can use this tool")).toBeVisible();
    await expect(page.getByText("Off for every bot")).toHaveCount(0);
    await expect
      .poll(async () => (await api.get(`/connections/${id}/tools/reset`)).enabled)
      .toBe(true);
    await expect.poll(async () => toolNames(await capability()).join(",")).toContain("reset");
  });

  await step("Reconnect from the detail page", async () => {
    await page.getByRole("link", { name, exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp(`/connections/${id}$`));
    const before = mcp.seen.keys.length;
    await page.getByRole("button", { name: "Reconnect" }).click();
    await expect(page.getByText("Reconnect started")).toBeVisible();
    await expect.poll(async () => (await conn()).status, { timeout: 30_000 }).toBe("connected");
    expect(mcp.seen.keys.length).toBeGreaterThan(before);
  });

  // No UI sets secretRef yet: this is the documented API (PATCH { secretRef }), then the
  // UI's Reconnect. The server only accepts the vault value from here on.
  await step(
    "api-only: header value from a vault API key (secretRef), then Reconnect",
    async () => {
      const res = await page.request.post("/api/v1/vault/step-up", {
        data: { password: DEMO.password },
      });
      expect(res.ok(), `step-up ${res.status()}`).toBe(true);
      stepUp = (await res.json()).data.token;
      const headers = { "X-Vault-Step-Up": stepUp };
      const made = await page.request.post("/api/v1/vault/items", {
        headers,
        data: {
          kind: "api_key",
          title: `Verify MCP key ${stamp}`,
          values: { value: vaultSecret },
          policy: { handle },
        },
      });
      expect(made.status(), await made.text()).toBe(201);
      cleanup(async () => {
        const r = await page.request.delete(`/api/v1/vault/items/${handle}?purge=true`, {
          headers,
        });
        if (!r.ok() && r.status() !== 404) throw new Error(`vault cleanup ${r.status()}`);
      });
      keys.clear();
      keys.add(vaultSecret);
      const patched = await api.patch(`/connections/${id}`, { secretRef: handle });
      expect(patched.secretRef).toBe(handle);
      expect(JSON.stringify(patched)).not.toContain(vaultSecret);
      await page.reload();
      await page.getByRole("button", { name: "Reconnect" }).click();
      await expect.poll(async () => (await conn()).status, { timeout: 30_000 }).toBe("connected");
      expect(mcp.seen.keys).toContain(vaultSecret);
      const detail = await api.get(`/vault/items/${handle}`);
      expect(JSON.stringify(detail)).not.toContain(vaultSecret);
    },
  );

  await step("an unreachable server lands under Needs attention with an error", async () => {
    const port = await deadPort();
    await page.goto("/connections");
    await page.getByRole("button", { name: "Add connection" }).click();
    const dialog = page.getByRole("dialog", { name: "Add connection" });
    await dialog.getByLabel("Name").fill(broken);
    await dialog.getByLabel("URL").fill(`http://127.0.0.1:${port}/mcp`);
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Connection added")).toBeVisible();
    cleanup(removeIfThere(broken));
    await expect
      .poll(async () => (await byName(broken))?.status, { timeout: 30_000 })
      .toBe("error");
    await expect(page.getByText("Error", { exact: true }).first()).toBeVisible();
    await page.goto("/connections");
    const attention = page.getByRole("link", { name: new RegExp(`^${broken}`) });
    await expect(attention).toBeVisible();
    await expect(page.getByText("Needs attention")).toBeVisible();
    const ok = page.getByRole("link", { name: new RegExp(`^${name}`) });
    await expect(ok).toContainText("2 tools · used by 1 bot");
  });
  await proof("list-attention");

  await step("remove warns about the bot, removes, uninstalls the tools", async () => {
    await page.getByRole("link", { name: new RegExp(`^${name}`) }).click();
    await page.getByRole("button", { name: "Remove" }).click();
    const dialog = page.getByRole("dialog", { name: "Remove connection?" });
    await expect(dialog).toContainText("1 bot will lose these tools");
    await dialog.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(page.getByText("Connection removed")).toBeVisible();
    await expect(page).toHaveURL(/\/connections$/);
    await expect(page.getByRole("link", { name: new RegExp(`^${name}`) })).toHaveCount(0);
    expect(await byName(name)).toBeUndefined();
    expect(await capability()).toBeUndefined();
    expect((await api.get(`/bots/${botId}`)).connectionIds).not.toContain(id);
  });
  await proof("removed");
});
