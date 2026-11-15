// Feature: workflow-e2e (features/workflow-e2e.md). One owner sets up an agent end to end through
// the UI: a bot, a skill attached to it, a local vault API key, a connection to a real local MCP
// server (started here, the app's own MCP SDK) whose header value comes from that vault item, the
// connection linked to the bot, and a routine for the bot that fires on its own schedule. Then:
// the result lands in the bot's chat as a quiet line, the attention signals (sidebar, tab title,
// favicon) stay quiet for it and still work for a question, and after a reload every piece is
// still wired. Everything is removed afterwards.
import { createServer } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
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
      properties: { value: { type: "string" } },
      required: ["value"],
    },
    annotations: { readOnlyHint: true },
  },
  { name: "reset", description: "Reset the counter", inputSchema: { type: "object" } },
];

/** Stateless Streamable HTTP MCP server on a free loopback port; only `key` gets in. */
async function startMcp(key) {
  const seen = { keys: [] };
  const server = createServer(async (req, res) => {
    if (new URL(req.url ?? "/", "http://x").pathname !== "/mcp") return res.writeHead(404).end();
    if (req.method !== "POST") return res.writeHead(405).end();
    const got = String(req.headers["x-api-key"] ?? "");
    seen.keys.push(got);
    if (got !== key) {
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
      { name: "verify-wf-mcp", version: "1.0.0" },
      { capabilities: { tools: {} } },
    );
    mcp.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
    mcp.setRequestHandler(CallToolRequestSchema, async ({ params }) => ({
      content: [{ type: "text", text: `${params.name}:${params.arguments?.value ?? ""}` }],
    }));
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

const IST_MS = 330 * 60_000; // IST is UTC+05:30 all year (no DST)
/** `YYYY-MM-DDTHH:mm` IST wall clock, the routine editor's datetime-local value. */
const istInput = (ms) => new Date(ms + IST_MS).toISOString().slice(0, 16);

await journey("workflow-e2e", async ({ page, step, proof, cleanup, api, stamp }) => {
  const botName = `WF Bot ${stamp}`;
  const skillName = `wf-skill-${stamp}`;
  const keyTitle = `WF key ${stamp}`;
  const handle = `wf-key-${stamp}`;
  const vaultSecret = `wf-vault-${stamp}-K3y`;
  const typedSecret = `typed-not-vault-${stamp}`;
  const connName = `WF MCP ${stamp}`;
  const routineName = `wf-routine-${stamp}`;
  const prompt = `workflow check ${stamp}`;
  let mcp;
  let botId;
  let skillId;
  let connId;
  let slug;
  let routineId;
  let fireAt;
  let stepUpToken;
  const composer = page.getByPlaceholder(new RegExp(`message ${botName}`, "i"));
  const botLink = () => page.getByRole("link", { name: new RegExp(`^${botName}`) });
  const favicon = () =>
    page.evaluate(() => document.querySelector('link[rel="icon"]')?.getAttribute("href"));
  const conn = () => api.get(`/connections/${connId}`);
  const capability = async () =>
    (await api.get("/capabilities")).capabilities.find((c) => c.id === `mcp:${slug}`);
  const toolNames = (cap) => (cap?.tools ?? []).map((t) => t.name ?? t);
  const nav = async (item) => {
    await page.getByRole("button", { name: "Account and navigation" }).click();
    await page.getByRole("menuitem", { name: item }).click();
  };
  const routineJobs = async () =>
    (await api.get("/jobs?name=routine-fire&limit=500")).jobs.filter(
      (j) => j.data?.routineId === routineId,
    );
  /** Purge the vault item; the UI's step-up token may have expired (5 min) by cleanup time. */
  const purgeVault = async () => {
    const purge = (token) =>
      page.request.delete(`/api/v1/vault/items/${handle}?purge=true`, {
        headers: { "X-Vault-Step-Up": token ?? "" },
      });
    let res = await purge(stepUpToken);
    if (res.status() === 401 || res.status() === 403) {
      const up = await page.request.post("/api/v1/vault/step-up", {
        data: { password: DEMO.password },
      });
      if (!up.ok()) throw new Error(`vault step-up for cleanup -> ${up.status()}`);
      res = await purge((await up.json()).data.token);
    }
    if (!res.ok() && res.status() !== 404) throw new Error(`vault purge -> ${res.status()}`);
  };
  /** Changing where a connection points or what it sends, or deleting it, needs a fresh step-up (S4). */
  const freshStepUp = async () => {
    const up = await page.request.post("/api/v1/vault/step-up", {
      data: { password: DEMO.password },
    });
    if (!up.ok()) throw new Error(`vault step-up -> ${up.status()}`);
    return (await up.json()).data.token;
  };
  const withStepUp = async (method, url, data) => {
    const res = await page.request.fetch(`/api/v1${url}`, {
      method,
      data,
      headers: { "X-Vault-Step-Up": await freshStepUp() },
    });
    return res;
  };

  // The scheduled fire pushes `routine.succeeded` when Pushover is configured.
  await step("guard: Pushover is not configured on this instance", async () => {
    expect((await api.get("/notifications/status")).state).toBe("not_configured");
  });
  await step("test fixture: a local MCP server that accepts only the vault key", async () => {
    mcp = await startMcp(vaultSecret);
    cleanup(() => mcp.close());
    // Runs after the routine is deleted: its routine-fire job rows (a fired job stays).
    cleanup(async () => {
      if (!routineId) return;
      for (const j of await routineJobs()) await api.delete(`/jobs/${j.id}`);
    });
  });

  await step("1. create the bot from New bot", async () => {
    await page
      .getByRole("button", { name: /new bot|create your first bot/i })
      .first()
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "Test Model (faux)" })).toBeVisible({
      timeout: 15_000,
    });
    await dialog.getByLabel("Name").fill(botName);
    await dialog.getByRole("button", { name: /create bot/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 15_000 });
    botId = (await api.get("/bots")).find((b) => b.name === botName)?.id;
    expect(botId, "bot row in GET /bots").toBeTruthy();
    cleanup(async () => {
      const res = await page.request.delete(`/api/v1/bots/${botId}`);
      if (!res.ok() && res.status() !== 404) throw new Error(`delete bot ${res.status()}`);
    });
    await expect(botLink()).toBeVisible();
  });

  await step("2. create a skill and attach it to the bot from the skill page", async () => {
    await nav("Skills");
    await page.getByRole("button", { name: "New skill" }).click();
    const dialog = page.getByRole("dialog", { name: "New skill" });
    await dialog.getByLabel("Name").fill(skillName);
    await dialog.getByLabel("Description").fill(`Workflow skill ${stamp}`);
    await dialog.getByLabel("Instructions").fill(`# Check ${stamp}\n\nReport briefly.`);
    await dialog.getByRole("button", { name: "Create skill" }).click();
    await expect(page.getByText("Skill created")).toBeVisible();
    skillId = (await api.get("/skills")).find((s) => s.name === skillName)?.id;
    expect(skillId, "skill row in GET /skills").toBeTruthy();
    cleanup(async () => {
      const res = await page.request.delete(`/api/v1/skills/${skillId}`);
      if (!res.ok() && res.status() !== 404) throw new Error(`delete skill ${res.status()}`);
    });
    const box = page.getByRole("checkbox", { name: `Use ${skillName} with ${botName}` });
    await box.click();
    await expect(box).toBeChecked();
    await expect.poll(async () => (await api.get(`/bots/${botId}`)).skillIds).toContain(skillId);
  });
  await proof("skill-attached");

  await step("3. a local vault API key, saved after the password step-up", async () => {
    await nav("Vault");
    await expect(page).toHaveURL(/\/vault$/);
    await page.getByRole("button", { name: "New item" }).click();
    const picker = page.getByRole("dialog", { name: "New item" });
    await expect(picker).toContainText("Saved in Local");
    await picker.getByRole("button", { name: "API key", exact: true }).click();
    await page.getByLabel("Name", { exact: true }).fill(keyTitle);
    await expect(page.getByLabel("Handle")).toHaveValue(handle);
    await page.getByLabel("Key", { exact: true }).fill(vaultSecret);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Confirm it's you" });
    const stepUp = page.waitForResponse((r) => r.url().endsWith("/api/v1/vault/step-up") && r.ok());
    await dialog.getByLabel("Password").fill(DEMO.password);
    await dialog.getByRole("button", { name: "Confirm" }).click();
    stepUpToken = (await (await stepUp).json()).data.token;
    cleanup(purgeVault);
    await expect(page).toHaveURL(new RegExp(`/vault/items/${handle}$`));
    await expect(page.getByRole("heading", { name: keyTitle })).toBeVisible();
    await expect(
      page.getByRole("listitem").filter({ hasText: /^created · vault_ui/ }),
    ).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: /^used · / })).toHaveCount(0);
    expect(await page.content()).not.toContain(vaultSecret);
  });
  await proof("vault-item");

  await step(
    "4. add the connection (header auth); a typed key is refused by the server",
    async () => {
      await nav("Connections");
      await page.getByRole("button", { name: "Add connection" }).click();
      const dialog = page.getByRole("dialog", { name: "Add connection" });
      await dialog.getByLabel("Name").fill(connName);
      await dialog.getByLabel("URL").fill(mcp.url);
      await dialog.getByRole("combobox", { name: "Authentication type" }).click();
      await page.getByRole("option", { name: "API key or header" }).click();
      await expect(dialog.getByLabel("Header name")).toHaveValue("x-api-key");
      await dialog.getByLabel("Secret").fill(typedSecret);
      await dialog.getByRole("button", { name: "Test connection" }).click();
      await expect(dialog.getByRole("alert")).toContainText("Test failed", { timeout: 20_000 });
      await dialog.getByRole("button", { name: "Save" }).click();
      await expect(page.getByText("Connection added")).toBeVisible();
      await expect(page).toHaveURL(/\/connections\/[^/]+$/);
      connId = page.url().split("/").pop();
      cleanup(async () => {
        const res = await withStepUp("DELETE", `/connections/${connId}`);
        if (!res.ok() && res.status() !== 404) throw new Error(`delete connection ${res.status()}`);
      });
      await expect.poll(async () => (await conn()).status, { timeout: 30_000 }).toBe("error");
      expect(mcp.seen.keys).toContain(typedSecret);
      expect(mcp.seen.keys).not.toContain(vaultSecret);
    },
  );
  await proof("connection-refused");

  // No UI sets secretRef yet (features/connections.md): the documented API, then the UI's Reconnect.
  await step(
    "api-only: point the header at the vault item (secretRef); Reconnect connects",
    async () => {
      const res = await withStepUp("PATCH", `/connections/${connId}`, { secretRef: handle });
      expect(res.ok()).toBe(true);
      expect((await res.json()).data.secretRef).toBe(handle);
      await page.reload();
      await page.getByRole("button", { name: "Reconnect" }).click();
      await expect(page.getByText("Reconnect started")).toBeVisible();
      await expect.poll(async () => (await conn()).status, { timeout: 30_000 }).toBe("connected");
      expect(mcp.seen.keys).toContain(vaultSecret);
      const row = await conn();
      slug = row.slug;
      expect(row).toMatchObject({ authType: "header", hasSecret: true, secretRef: handle });
      expect(JSON.stringify(row)).not.toContain(vaultSecret);
      await expect(page.getByText("Connected", { exact: true }).first()).toBeVisible();
      await expect(page.getByRole("link", { name: /^echo\b/ })).toBeVisible();
      await expect(page.getByRole("link", { name: /^reset\b/ })).toBeVisible();
      expect(await page.content()).not.toContain(vaultSecret);
    },
  );

  await step("5. link the connection to the bot (Used by bots)", async () => {
    const box = page.getByRole("checkbox", { name: `Use ${connName} tools in ${botName}` });
    await box.click();
    await expect(box).toBeChecked();
    await expect.poll(async () => (await conn()).botIds).toContain(botId);
    expect((await api.get(`/bots/${botId}`)).connectionIds).toContain(connId);
    await expect
      .poll(async () =>
        toolNames(await capability())
          .sort()
          .join(","),
      )
      .toBe(`mcp__${slug}__echo,mcp__${slug}__reset`);
  });
  await proof("connection-linked");

  await step("the vault item's Activity shows the connection used it", async () => {
    await page.goto(`/vault/items/${handle}`);
    const used = page.getByRole("listitem").filter({ hasText: /^used · mcp/ });
    await expect(used.first()).toContainText(`mcp:${slug}`);
    expect(await page.content()).not.toContain(vaultSecret);
  });
  await proof("vault-used");

  await step("6. schedule a once routine for the bot, 1-2 minutes ahead (editor)", async () => {
    await nav("Routines");
    await expect(page).toHaveURL(/\/routines$/);
    await page
      .getByRole("button", { name: /new routine/i })
      .first()
      .click();
    const dialog = page.getByRole("dialog", { name: "New routine" });
    await dialog.getByRole("combobox", { name: "Bot" }).click();
    await page.getByRole("option", { name: botName }).click();
    await dialog.getByLabel("Prompt").fill(prompt);
    await dialog.getByLabel(/^Name/).fill(routineName);
    await dialog.getByRole("tab", { name: "Once" }).click();
    fireAt = Math.floor((Date.now() + 120_000) / 60_000) * 60_000;
    await dialog.getByLabel("Run at (IST)").fill(istInput(fireAt));
    await expect(
      dialog.getByText(new RegExp(`^Once, .*${istInput(fireAt).slice(11)} IST$`)),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Create" }).click();
    await expect(page.getByText("Routine created")).toBeVisible();
    routineId = (await api.get("/routines")).find((r) => r.name === routineName)?.id;
    expect(routineId, "routine row in GET /routines").toBeTruthy();
    cleanup(async () => {
      const res = await page.request.delete(`/api/v1/routines/${routineId}`);
      if (!res.ok() && res.status() !== 404) throw new Error(`delete routine ${res.status()}`);
    });
    const row = await api.get(`/routines/${routineId}`);
    expect(row).toMatchObject({ botId, enabled: true });
    expect(new Date(row.nextRunAt).getTime()).toBe(fireAt);
    expect((await routineJobs()).map((j) => j.state)).toEqual(["created"]);
  });
  await proof("routine-armed");

  await step("elsewhere in the app before the slot: no attention signal", async () => {
    await page.getByRole("link", { name: "Tasks" }).click();
    await expect(page).toHaveTitle("Tasks · tiny-agents");
    await expect(botLink()).toHaveAccessibleName(botName);
    expect(await favicon()).toBe("/favicon.svg");
  });

  // Up to 120 s until the slot, the queue's 5 s poll, the faux reply at 6 tokens/s, margin.
  await step("7. the routine fires by itself; its run succeeds (API)", async () => {
    await expect
      .poll(
        async () =>
          (await api.get(`/routines/${routineId}/runs`)).runs.map(
            (r) => `${r.trigger}:${r.status}`,
          ),
        { timeout: Math.max(0, fireAt - Date.now()) + 120_000, intervals: [2_000] },
      )
      .toEqual(["schedule:succeeded"]);
    const [run] = (await api.get(`/routines/${routineId}/runs`)).runs;
    expect(new Date(run.scheduledFor).getTime()).toBe(fireAt);
    expect(run.output).toMatch(/^Echo: /);
    expect(run.output).toContain(prompt);
    expect((await routineJobs()).map((j) => j.state)).toEqual(["completed"]);
  });

  // features/notifications.md: the count, label and badge mean a bot waits on an approval or
  // a question. A routine result waits on nobody (and is not the bot's chat), so all stay quiet.
  await step(
    "a finished routine run raises no attention signal (title, sidebar, favicon)",
    async () => {
      await page.waitForTimeout(3_000); // let the bot list refetch after the run settles
      await expect(page).toHaveTitle("Tasks · tiny-agents");
      await expect(botLink()).toHaveAccessibleName(botName); // not "…, unread" / "…, 1 question…"
      await expect(page.getByLabel("Unread", { exact: true })).toHaveCount(0);
      expect(await favicon()).toBe("/favicon.svg");
      const bot = (await api.get("/bots")).find((b) => b.id === botId);
      expect(bot).toMatchObject({ unread: false, approvals: 0, questions: 0, replying: false });
    },
  );
  await proof("quiet-after-run");

  await step("8. the result lands in the bot's chat as one quiet line", async () => {
    await botLink().click();
    await expect(page).toHaveTitle(`${botName} · tiny-agents`);
    const line = page.getByTestId("routine-runs").filter({ hasText: routineName });
    await expect(line).toBeVisible({ timeout: 30_000 });
    await expect(line.getByRole("button")).toContainText("done");
    await line.getByRole("button").click();
    const detail = line.getByTestId("routine-run");
    await expect(detail).toHaveAttribute("data-status", "succeeded");
    await expect(detail).toContainText(prompt);
    await expect(detail).not.toContainText("run now");
    await expect(page.getByText(`Echo: **Routine`)).toHaveCount(0);
  });
  await proof("chat-line");

  await step(
    "the signal itself works for this bot: /ask raises (1), answering clears it",
    async () => {
      await composer.fill("/ask set up the project");
      await composer.press("Enter");
      const card = page.getByTestId("question-card");
      await expect(card).toBeVisible({ timeout: 45_000 });
      await expect(page).toHaveTitle(`(1) ${botName} · tiny-agents`);
      await expect(page.getByLabel("1 question for you", { exact: true })).toBeVisible();
      expect(await favicon()).not.toBe("/favicon.svg");
      await proof("attention-question");
      await card.getByRole("radio", { name: /React/ }).click();
      await card.getByRole("checkbox", { name: /Auth/ }).click();
      await card.getByRole("button", { name: /Next/ }).click();
      await card.getByRole("textbox", { name: "Anything else I should know?" }).fill(stamp);
      await card.getByRole("button", { name: /Send answers/ }).click();
      await expect(card).not.toBeVisible({ timeout: 15_000 });
      await expect(page).toHaveTitle(`${botName} · tiny-agents`, { timeout: 15_000 });
      expect(await favicon()).toBe("/favicon.svg");
    },
  );

  await step("9. after a reload everything is still wired (API)", async () => {
    await page.reload();
    await expect(page.getByTestId("routine-runs").filter({ hasText: routineName })).toBeVisible({
      timeout: 30_000,
    });
    const bot = await api.get(`/bots/${botId}`);
    expect(bot.skillIds).toContain(skillId);
    expect(bot.connectionIds).toContain(connId);
    expect((await api.get(`/skills/${skillId}`)).botIds).toContain(botId);
    const row = await conn();
    expect(row).toMatchObject({ status: "connected", secretRef: handle });
    expect(row.botIds).toContain(botId);
    expect(row.tools.map((t) => t.name).sort()).toEqual(
      [`mcp__${slug}__echo`, `mcp__${slug}__reset`].sort(),
    );
    expect(toolNames(await capability()).sort()).toEqual([
      `mcp__${slug}__echo`,
      `mcp__${slug}__reset`,
    ]);
    expect(await api.get(`/routines/${routineId}`)).toMatchObject({ botId, done: true });
  });

  await step("the bot's Edit dialog shows the skill and the connection on", async () => {
    await page.getByRole("button", { name: `${botName} actions` }).click();
    await page.getByRole("menuitem", { name: "Edit bot" }).click();
    const dialog = page.getByRole("dialog", { name: `Edit ${botName}` });
    await dialog.getByRole("tab", { name: "Skills" }).click();
    await expect(dialog.getByRole("switch", { name: `Assign ${skillName}` })).toBeChecked();
    await dialog.getByRole("tab", { name: "Tools" }).click();
    const sw = dialog.getByRole("switch", { name: `Enable ${connName}` });
    await sw.scrollIntoViewIfNeeded();
    await expect(sw).toBeChecked();
    await proof("bot-wired");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).not.toBeVisible();
  });

  await step("Connections and Routines pages agree after the reload", async () => {
    await nav("Connections");
    await expect(page.getByRole("link", { name: new RegExp(`^${connName}`) })).toContainText(
      "2 tools · used by 1 bot",
    );
    await nav("Routines");
    const run = page.getByRole("listitem").filter({ hasText: routineName }).filter({
      hasText: "succeeded",
    });
    await expect(run).toContainText("schedule");
  });
  await proof("pages-after-reload");
});
