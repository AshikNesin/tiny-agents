#!/usr/bin/env node
import { spawn, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const PORT = 3160;
const URL_ = `http://localhost:${PORT}`;
process.env.TA_URL ??= URL_;
const { open, api, dumpCss, snap, verify, ROOT, ignoreNetworkStillBusy, signalGroupIfRunning } =
  await import("./snaplib.mjs");

const TOOLS = import.meta.dirname;
const REPO = path.resolve(TOOLS, "../../../..");
const STATE = path.join(REPO, "data/verify/montage");
const ACCOUNT = { email: "demo@example.com", password: "demo@example.com", name: "Ashik" }; // gitleaks:allow
const MODEL = "test-model";
const MODES = (process.env.MODES ?? "desktop,mobile").split(",");
const ONLY = process.env.ONLY?.split(",");
const want = (name) => !ONLY || ONLY.includes(name);
const log = (...a) => console.log("[montage]", ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const BOTS = [
  {
    name: "Researcher",
    description: "Digs through the web",
    toolPermissions: { web_search: "ask", web_fetch: "ask" },
  },
  { name: "Chief of Staff", description: "Runs the team" },
  {
    name: "Travel Planner",
    description: "Plans trips and watches fares",
    toolPermissions: { remember: "allow" },
  },
  {
    name: "Code Buddy",
    description: "Fixes bugs and ships code",
    toolPermissions: { remember: "allow" },
  },
];

const RESEARCH_PROMPT = "Find beach hostels in Goa under ₹1,500 a night.";
const RESEARCH_REPLY = "Your report is ready. Three areas fit the budget:";

const MEMORIES = {
  "Travel Planner": {
    say: "Remember for my trips: I prefer window seats, my flight budget is under ₹6,000 one way, and I travel with Sonaal.",
    texts: ["Prefers window seats", "Flight budget: under ₹6,000 one way", "Travels with Sonaal"],
  },
  "Code Buddy": {
    say: "Remember that I work in the ~/code/shop repo.",
    texts: ["Works in the ~/code/shop repo"],
  },
};

const RELEASE = (sha, subject, committedAt) => ({ sha, version: "1.3.0", subject, committedAt });
const UPDATE_COMMITS = [
  ["c20fb910d0b1", "UI pass: phone page headers, settings menu button, empty states", 1794770116e3],
  ["b5decd7f52aa", "Keep the driving frame inside the view's rounded corners", 1794767167e3],
  ["72073804c1e9", "Make the live views minimal: click the stream to take control", 1794766586e3],
];
const UPDATE_STATUS = () => ({
  track: "origin/main",
  current: RELEASE("4727c908a37f", "Open push notification links in the Android app", 1794759734e3),
  latest: RELEASE(...UPDATE_COMMITS[0]),
  commits: UPDATE_COMMITS.map(([sha, subject]) => ({ sha: sha.slice(0, 7), subject })),
  sandboxChanged: false,
  phase: "idle",
  error: null,
  log: [],
  auto: false,
  lastCheckedAt: Date.now(),
});

const iso = (minutesAgo) => new Date(Date.now() - minutesAgo * 60_000).toISOString();

const tool = (slug, serverName, label, description, readOnly = true) => ({
  name: `mcp__${slug}__${serverName}`,
  serverName,
  label,
  description,
  readOnly,
  enabled: true,
});
const connection = (id, name, slug, url, tools, botIds) => ({
  id,
  name,
  slug,
  url,
  transport: "streamable-http",
  authType: "oauth",
  headerName: null,
  hasSecret: false,
  secretRef: null,
  tools,
  botIds,
  status: "connected",
  createdAt: iso(60 * 24 * 12),
});
const CONNECTIONS = (bot) => [
  connection(
    "conn_github",
    "GitHub",
    "github",
    "https://api.githubcopilot.com/mcp/",
    [
      tool("github", "search_repositories", "Search repositories", "Find repositories"),
      tool("github", "get_file_contents", "Get file contents", "Read a file or directory"),
      tool("github", "list_issues", "List issues", "List a repository's issues"),
      tool(
        "github",
        "list_pull_requests",
        "List pull requests",
        "List a repository's pull requests",
      ),
      tool("github", "create_pull_request", "Create pull request", "Open a pull request", false),
      tool("github", "add_issue_comment", "Add issue comment", "Comment on an issue", false),
    ],
    [bot["Code Buddy"], bot["Chief of Staff"]],
  ),
  connection(
    "conn_linear",
    "Linear",
    "linear",
    "https://mcp.linear.app/mcp",
    [
      tool("linear", "list_issues", "List issues", "List issues"),
      tool("linear", "get_issue", "Get issue", "Read one issue"),
      tool("linear", "create_issue", "Create issue", "Create an issue", false),
      tool("linear", "update_issue", "Update issue", "Change an issue", false),
    ],
    [bot["Code Buddy"], bot["Chief of Staff"]],
  ),
  connection(
    "conn_gcal",
    "Google Calendar",
    "google-calendar",
    "https://calendar.example.com/mcp",
    [
      tool("google-calendar", "list_events", "List events", "List events in a time range"),
      tool("google-calendar", "find_free_time", "Find free time", "Find open slots"),
      tool("google-calendar", "create_event", "Create event", "Add an event", false),
    ],
    [bot["Travel Planner"], bot["Chief of Staff"]],
  ),
];

const model = (id, name, o = {}) => ({
  id,
  upstreamId: o.upstreamId ?? id,
  name,
  type: "chat",
  source: "discovered",
  enabled: true,
  contextWindow: o.contextWindow ?? 200_000,
  maxOutputTokens: o.maxOutputTokens ?? 64_000,
  imageInput: o.imageInput ?? true,
  reasoning: o.reasoning ?? true,
  overrides: {},
  compat: null,
  missing: false,
  usedBy: o.usedBy ?? 0,
});
const account = (id, name, kind, baseUrl, hint, models, extra = {}) => ({
  id,
  name,
  kind,
  baseUrl,
  viaProviderId: null,
  settings: {},
  discovery: "auto",
  allowPrivateNetwork: false,
  enabled: true,
  status: "ok",
  statusDetail: null,
  checkedAt: iso(42),
  version: 1,
  credential: hint ? { hint, backend: "local" } : null,
  models,
  ...extra,
});
const ACCOUNTS = [
  account(
    "acct_anthropic",
    "Anthropic · Work",
    "anthropic",
    "https://api.anthropic.com",
    "sk-ant-…demo",
    [
      model("m_opus", "Claude Opus 5.5", { upstreamId: "claude-opus-5-5", usedBy: 1 }),
      model("m_sonnet", "Claude Sonnet 5.5", { upstreamId: "claude-sonnet-5-5", usedBy: 3 }),
    ],
  ),
  account(
    "acct_claude_plan",
    "Claude plan",
    "claude-plan",
    null,
    null,
    [model("m_plan_sonnet", "Claude Sonnet 5.5", { upstreamId: "claude-sonnet-5-5" })],
    { settings: { fallbackModelId: "m_sonnet" } },
  ),
  account(
    "acct_ollama",
    "Ollama (local)",
    "openai-chat",
    "http://localhost:11434/v1",
    null,
    [
      model("m_llama", "Llama 3.3", {
        upstreamId: "llama3.3",
        contextWindow: 128_000,
        maxOutputTokens: 8_192,
        imageInput: false,
        reasoning: false,
      }),
      model("m_qwen", "Qwen 2.5 Coder", {
        upstreamId: "qwen2.5-coder",
        contextWindow: 32_000,
        maxOutputTokens: 8_192,
        imageInput: false,
        reasoning: false,
      }),
    ],
    { allowPrivateNetwork: true },
  ),
  account("acct_openai", "OpenAI", "openai-responses", "https://api.openai.com/v1", "sk-…demo", [
    model("m_gpt", "GPT-5.4", {
      upstreamId: "gpt-5.4",
      contextWindow: 400_000,
      maxOutputTokens: 128_000,
    }),
    model("m_gpt_mini", "GPT-5.4 mini", {
      upstreamId: "gpt-5.4-mini",
      contextWindow: 400_000,
      maxOutputTokens: 128_000,
    }),
  ]),
];
const ROLES = {
  bot_default: { modelId: "m_sonnet", fallback: false },
  memory_capture: { modelId: "m_sonnet", fallback: true },
  chat_title: { modelId: "m_sonnet", fallback: true },
  vision: { modelId: "m_opus", fallback: true },
  classifier: { modelId: null, fallback: true },
};

const E = "\x1b[";
const PROMPT = `${E}1;32mashik@sandbox${E}0m:${E}1;34m~/code/shop${E}0m$ `;
const TEST_FILES = [
  ["tests/cart.test.ts", 7],
  ["tests/checkout.test.ts", 6],
  ["tests/coupons.test.ts", 4],
  ["tests/format.test.ts", 6],
  ["tests/inventory.test.ts", 5],
  ["tests/login.test.ts", 5],
  ["tests/orders.test.ts", 6],
  ["tests/pricing.test.ts", 5],
  ["tests/search.test.ts", 4],
];
const TERMINAL_SCREEN = [
  `${PROMPT}pnpm test`,
  "",
  "> shop@1.0.0 test /home/ashik/code/shop",
  "> vitest run",
  "",
  ...TEST_FILES.map(([file, n]) => ` ${E}32m✓${E}0m ${file} ${E}90m(${n} tests)${E}0m`),
  "",
  `${E}90m Test Files ${E}0m ${E}1;32m9 passed${E}0m${E}90m (9)${E}0m`,
  `${E}90m      Tests ${E}0m ${E}1;32m48 passed${E}0m${E}90m (48)${E}0m`,
  "",
  PROMPT,
].join("\r\n");

const ready = async () => {
  try {
    const res = await fetch(`${URL_}/ready`, { signal: AbortSignal.timeout(3000) });
    return res.ok && (await res.json()).ready === true;
  } catch {
    return false;
  }
};

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const ours = (pid) => {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, "utf8").includes("montage-faux.mjs");
  } catch {
    return false;
  }
};

async function stopOurs() {
  const file = path.join(STATE, "run.json");
  if (!existsSync(file)) return;
  const { pgid } = JSON.parse(readFileSync(file, "utf8"));
  if (pgid && alive(pgid)) {
    if (!ours(pgid)) return log(`pid ${pgid} is not our server; not killing it`);
    log(`stopping our instance (process group ${pgid})`);
    signalGroupIfRunning(pgid, "SIGTERM");
    for (let i = 0; i < 60 && alive(pgid); i++) await sleep(250);
    if (alive(pgid)) process.kill(-pgid, "SIGKILL");
  }
}

async function ensureInstance() {
  if (process.argv.includes("--fresh")) {
    await stopOurs();
    rmSync(STATE, { recursive: true, force: true });
  }
  if (await ready()) return log(`instance already up at ${URL_}`);
  await stopOurs();
  mkdirSync(path.join(STATE, "uploads"), { recursive: true });

  const SAFE =
    /^(PATH|HOME|USER|LOGNAME|SHELL|LANG|LC_\w+|TZ|TMPDIR|TERM|NODE_EXTRA_CA_CERTS|SSL_CERT_FILE)$/;
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => SAFE.test(k)));
  const dotenv = path.join(REPO, ".env");
  if (existsSync(dotenv)) {
    for (const line of readFileSync(dotenv, "utf8").split("\n")) {
      const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
      if (match) env[match[1]] = "";
    }
  }
  const blank =
    "PUSHOVER_API_TOKEN PUSHOVER_USER_KEY CLOUDFLARE_API_KEY CLOUDFLARE_ACCOUNT_ID CLOUDFLARE_GATEWAY_ID OPENAI_API_KEY ANTHROPIC_API_KEY GEMINI_API_KEY GOOGLE_API_KEY OPENROUTER_API_KEY GROQ_API_KEY MISTRAL_API_KEY AI_PROVIDERS DEFAULT_MODEL SENTRY_DSN SENTRY_AUTH_TOKEN SHELLEY_URL CLAUDE_CODE_ENGINE_ENABLED SANDBOX_HOST SANDBOX_PORT SANDBOX_USER SANDBOX_SSH_KEY_FILE DATA_DIR";
  for (const key of blank.split(" ")) env[key] = "";
  const secretsKey = randomBytes(32).toString("base64");
  const adminKey = randomBytes(24).toString("hex");
  Object.assign(env, {
    NODE_ENV: "development",
    PORT: String(PORT),
    ORIGIN: URL_,
    RP_ID: "localhost",
    DATABASE_URL: `file:${STATE}/app.db`,
    AGENT_DB_PATH: path.join(STATE, "agent.db"),
    UPLOADS_DIR: path.join(STATE, "uploads"),
    TINY_AGENTS_FAUX: "1",
    AUTH_RATE_LIMIT_MAX: "1000",
    SECRETS_KEY: secretsKey,
    ADMIN_AUTH_KEY: adminKey,
    PORTLESS: "0",
    NODE_OPTIONS: "--max-old-space-size=1024",
    TINYFISH_API_KEY: "demo-key-not-real", // gitleaks:allow
    TINY_AGENTS_SUPERVISED: "1",
  });

  const out = openSync(path.join(STATE, "server.log"), "a");
  const child = spawn(
    process.execPath,
    [
      "--import",
      path.join(REPO, "node_modules/tsx/dist/loader.mjs"),
      "--import",
      path.join(TOOLS, "montage-faux.mjs"),
      "apps/web/src/server/entry.node.ts",
    ],
    { cwd: REPO, env, detached: true, stdio: ["ignore", out, out, "ipc"] },
  );
  const revision = execFileSync("git", ["-C", REPO, "rev-parse", "--short", "HEAD"], {
    encoding: "utf8",
  }).trim();
  writeFileSync(
    path.join(STATE, "run.json"),
    JSON.stringify(
      {
        id: "montage",
        port: PORT,
        url: URL_,
        stateDir: STATE,
        evidenceDir: path.join(REPO, "data/verify-evidence/montage"),
        revision,
        startedAt: new Date().toISOString(),
        empty: true,
        secretsKey,
        adminKey,
        pid: child.pid,
        pgid: child.pid,
      },
      null,
      2,
    ),
  );
  log(`started pid ${child.pid}; log data/verify/montage/server.log`);

  const supervised = new Promise((resolve, reject) => {
    child.on("message", (message) => {
      if (message?.type !== "server-ready") return;
      child.send({ type: "update-status", status: UPDATE_STATUS() }, (error) =>
        error ? reject(error) : resolve(),
      );
    });
    child.on("exit", (code) =>
      reject(new Error(`server exited during boot (${code}); see server.log`)),
    );
  });
  const deadline = Date.now() + 240_000;
  while (!(await ready())) {
    if (Date.now() > deadline) throw new Error("instance not ready after 240s; see server.log");
    await sleep(1000);
  }
  await supervised;
  await sleep(300);
  child.removeAllListeners("exit");
  child.disconnect();
  child.unref();
  log(`READY ${URL_}`);
}

async function ensureAccount() {
  const post = (url, body) =>
    fetch(`${URL_}/api/v1${url}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: URL_ },
      body: JSON.stringify(body),
    });
  const { data } = await (await fetch(`${URL_}/api/v1/auth/setup`)).json();
  if (!data.needsSetup) return;
  const res = await post("/auth/setup", ACCOUNT);
  if (!res.ok) throw new Error(`setup -> ${res.status} ${await res.text()}`);
  log(`account created: ${ACCOUNT.name}`);
}

const botIds = {};

async function ensureBots(page) {
  const have = await api(page, "GET", "/bots");
  for (const bot of BOTS) {
    const found = have.find((b) => b.name === bot.name);
    botIds[bot.name] = found
      ? found.id
      : (await api(page, "POST", "/bots", { modelId: MODEL, ...bot })).id;
    if (!found) log(`bot created: ${bot.name}`);
  }
}

async function ensureMemories(page) {
  for (const [name, { say, texts }] of Object.entries(MEMORIES)) {
    const id = botIds[name];
    const missing = async () => {
      const { memories } = await api(page, "GET", `/bots/${id}/memories`);
      const saved = memories.filter((m) => m.status === "active").map((m) => m.text);
      return texts.filter((t) => !saved.includes(t));
    };
    if ((await missing()).length === 0) continue;
    await api(page, "POST", `/bots/${id}/messages`, { requestId: crypto.randomUUID(), text: say });
    for (let i = 0; i < 120 && (await missing()).length > 0; i++) await sleep(250);
    const still = await missing();
    if (still.length > 0) throw new Error(`${name} did not save: ${still.join("; ")}`);
    log(`memories saved from chat: ${name}`);
  }
}

const researcher = (page) => ({
  composer: page.getByRole("textbox", { name: "Message Researcher" }),
  menuButton: page.getByRole("button", { name: "Researcher menu" }),
  toggle: page.getByTestId("yolo-toggle"),
  banner: page.getByTestId("yolo-banner"),
  reply: page.getByText(RESEARCH_REPLY, { exact: true }),
  yoloRows: page.getByText(/auto-approved \(YOLO\)/),
  stop: page.getByRole("button", { name: "Stop generating" }),
});

async function ensureResearcherChat(page) {
  const r = researcher(page);
  await page.goto(`/chats/${botIds.Researcher}`);
  await r.composer.waitFor();
  await page.waitForLoadState("networkidle").catch(ignoreNetworkStillBusy);
  if (!(await r.banner.isVisible())) {
    await r.menuButton.click();
    await r.toggle.click();
    await page
      .getByRole("dialog", { name: "Turn on YOLO mode?" })
      .getByRole("button", { name: "Turn on", exact: true })
      .click();
    await r.banner.waitFor();
    log("YOLO turned on from the bot menu");
  }
  if (!(await r.reply.isVisible())) {
    await r.composer.fill(RESEARCH_PROMPT);
    await r.composer.press("Enter");
    await r.reply.waitFor({ timeout: 60_000 });
    await r.stop.waitFor({ state: "detached", timeout: 60_000 });
    log("Researcher answered");
  }
}

const MODEL_NAME = "Claude Sonnet 5.5";
async function ensureModelName(page) {
  const { accounts } = await api(page, "GET", "/models/providers");
  const row = accounts.flatMap((a) => a.models).find((m) => m.upstreamId === MODEL);
  if (row && row.name !== MODEL_NAME) {
    await api(page, "PATCH", `/models/${row.id}`, { name: MODEL_NAME });
    log(`model ${MODEL} named ${MODEL_NAME}`);
  }
}

const noGutter = (page) =>
  page.locator('[data-slot="message-scroller-viewport"]').evaluateAll((els) => {
    for (const el of els) el.style.scrollbarGutter = "auto";
  });

async function openToolGroup(page) {
  const r = researcher(page);
  const group = page.getByTestId("tool-group");
  if ((await r.yoloRows.count()) === 0) await group.getByRole("button").first().click();
  await r.yoloRows.nth(1).waitFor();
  const rows = await r.yoloRows.count();
  if (rows < 2) throw new Error(`expected auto-approved (YOLO) rows, found ${rows}`);
}

const answerGet = (page, glob, data) =>
  page.route(glob, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const response = await route.fetch();
    const json = await response.json();
    const body = {
      ...json,
      success: true,
      data: typeof data === "function" ? data(json.data) : data,
    };
    delete body.error;
    await route.fulfill({ status: 200, headers: response.headers(), json: body });
  });

const routeConnections = (page) => answerGet(page, "**/api/v1/connections", CONNECTIONS(botIds));

async function routeModels(page) {
  await answerGet(page, "**/api/v1/models/providers", (real) => ({ ...real, accounts: ACCOUNTS }));
  await answerGet(page, "**/api/v1/models/roles", { roles: ROLES });
}

async function routeTerminal(page) {
  await page.context().addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...rest) {
      return kind === "webgl2" ? null : getContext.call(this, kind, ...rest);
    };
  });
  const session = { name: "ta-term-1", process: null, attached: true, createdAt: iso(18) };
  await answerGet(page, "**/api/v1/terminal/sessions", {
    status: { kind: "ready" },
    sessions: [session],
  });
  await page.route("**/api/v1/terminal/sessions/ta-term-1/ticket", (route) =>
    route.fulfill({
      json: { success: true, data: { path: "/api/v1/terminal/ws/ta-term-1?ticket=montage" } },
    }),
  );
  await page.routeWebSocket(/\/api\/v1\/terminal\/ws\//, (ws) => {
    ws.onMessage((message) => {
      if (typeof message === "string" && message.includes('"ping"')) ws.send('{"t":"pong"}');
    });
    ws.send(Buffer.from(TERMINAL_SCREEN, "utf8"));
  });
}

const STATES = {
  memory: async ({ page }) => {
    await page.goto("/memory");
    await page.getByText("Works in the ~/code/shop repo").waitFor();
    await page.getByText("Prefers window seats").waitFor();
  },
  connections: async ({ page }) => {
    await routeConnections(page);
    await page.goto("/connections");
    await page.getByText("Google Calendar").waitFor();
  },
  models: async ({ page, mode }) => {
    await routeModels(page);
    await page.goto("/settings/models");
    const anthropic = page.getByRole("button", { name: "Anthropic · Work", exact: true });
    await anthropic.click();
    await page.getByText("claude-sonnet-5-5").first().waitFor();
    if (mode === "desktop")
      await anthropic.evaluate((button) => {
        const card = button.closest('[data-slot="card"]') ?? button;
        let pane = card.parentElement;
        while (
          pane &&
          !(
            pane.scrollHeight > pane.clientHeight &&
            /auto|scroll/.test(getComputedStyle(pane).overflowY)
          )
        )
          pane = pane.parentElement;
        if (!pane) return;
        const header = pane.querySelector("header");
        const below = header
          ? header.getBoundingClientRect().bottom
          : pane.getBoundingClientRect().top;
        pane.scrollTop += card.getBoundingClientRect().top - below - 16;
        document.scrollingElement.scrollTop = 0;
      });
  },
  updates: async ({ page }) => {
    await page.goto("/settings/updates");
    await page.getByRole("button", { name: "Update & restart" }).waitFor();
  },
  yolo: async ({ page, mode }) => {
    const r = researcher(page);
    await page.goto(`/chats/${botIds.Researcher}`);
    await r.banner.waitFor();
    await r.reply.waitFor();
    await openToolGroup(page);
    if (mode === "mobile") await noGutter(page);
  },
  "yolo-menu": async ({ page, mode }) => {
    const r = researcher(page);
    if (!(await r.banner.isVisible())) await STATES.yolo({ page, mode });
    await openToolGroup(page);
    if (mode === "mobile") await noGutter(page);
    await r.menuButton.click();
    await r.toggle.waitFor();
    await page.waitForTimeout(400);
    await page.getByRole("menu").focus();
    await page.waitForTimeout(150);
  },
  terminal: async ({ page }) => {
    await routeTerminal(page);
    await page.goto("/terminal");
    await page
      .getByTestId("terminal-tab-status-ta-term-1")
      .and(page.locator('[data-state="live"]'))
      .waitFor();
    await page.getByText("48 passed").waitFor();
  },
};

await ensureInstance();
await ensureAccount();

const results = [];
for (const mode of MODES) {
  const session = await open(mode, ACCOUNT);
  const { page } = session;
  page.on("pageerror", (error) => log(`pageerror: ${error.message}`));
  await session.ctx.routeWebSocket(new RegExp(`//localhost:${PORT + 1}/`), () => {});
  await session.ctx.route(
    (url) => !["localhost", "api.dicebear.com"].includes(url.hostname),
    (route) => route.abort("blockedbyclient"),
  );
  await page.reload();
  await ensureModelName(page);
  await ensureBots(page);
  await ensureMemories(page);
  await ensureResearcherChat(page);
  for (const [name, stage] of Object.entries(STATES)) {
    if (!want(name)) continue;
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await stage(session);
    await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(ignoreNetworkStillBusy);
    await page.mouse.move(0, 0);
    await dumpCss(page, mode);
    await snap(session, name);
    results.push([mode, name]);
    log(`snapped ${mode}/${name}`);
    if (name === "yolo-menu") await page.keyboard.press("Escape");
  }
  await session.browser.close();
}

let failed = false;
for (const [mode, name] of results) {
  const diff = await verify(mode, name);
  const ok = diff < 0.003;
  if (!ok) failed = true;
  log(`verify ${mode}/${name} ${diff.toFixed(5)} ${ok ? "ok" : "OVER 0.003"}`);
}
log(
  `snapshots in ${path.relative(REPO, path.join(ROOT, "snap"))}; instance left running at ${URL_}`,
);
process.exit(failed ? 1 : 0);
