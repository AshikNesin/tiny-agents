#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

const PORT = 3130;
const URL_BASE = `http://localhost:${PORT}`;
process.env.TA_URL = URL_BASE;
const { open, api, dumpCss, snap, verify, SIZES } = await import("./snaplib.mjs");

const REPO = path.resolve(import.meta.dirname, "../../../..");
const STATE = path.join(REPO, "data/verify/inbox");
const RUN_FILE = path.join(STATE, "run.json");
const CLOCK_FILE = path.join(STATE, "clock-offset");
const LOGIN = { email: "demo@example.com", password: "demo@example.com" }; // gitleaks:allow
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...parts) => console.log("[stage-inbox]", ...parts);

const BOTS = [
  {
    key: "researcher",
    name: "Researcher",
    description: "Digs through the web",
    ago: 5 * HOUR,
    ask: "Find beach hostels in Goa under ₹1,500 a night.",
    preview: "Your report is ready.",
    last: "Arambol: long stays, ₹600 to ₹1,100",
  },
  {
    key: "chief",
    name: "Chief of Staff",
    description: "Runs the team",
    ago: 3 * HOUR,
    ask: "Make me an Expense Tracker bot. Log receipts I send it.",
    preview: "Expense Tracker is ready for your OK.",
    last: "Expense Tracker is ready for your OK.",
    waits: true,
  },
  {
    key: "travel",
    name: "Travel Planner",
    description: "Plans trips and watches fares",
    ago: 1 * HOUR,
    ask: "Check Chennai to Goa fares for Friday.",
    preview:
      "Goa fares dropped ₹4,200. The 6:15 AM nonstop on Friday is ₹5,840, under your ₹6,000 limit, so I'm booking two seats.",
    last: "so I'm booking two seats.",
    waits: true,
  },
  {
    key: "code",
    name: "Code Buddy",
    description: "Fixes bugs and ships code",
    ago: 12 * MINUTE,
    ask: "The checkout test is flaky. Fix it and run the suite.",
    preview: "Fixed. All 48 tests pass.",
    last: "The change is on branch fix/checkout-flake.",
  },
];
const BY_KEY = Object.fromEntries(BOTS.map((b) => [b.key, b]));
const NEW_BOT = "Expense Tracker";
const CHIEF_AFTER = "Expense Tracker has joined the team. Send it a receipt to try it.";
const TRAVEL_AFTER = "Done. You're in 14A and 14B.";

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function answers(port) {
  try {
    await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(1500) });
    return true;
  } catch {
    return false;
  }
}

async function down() {
  if (existsSync(RUN_FILE)) {
    const { pid } = JSON.parse(readFileSync(RUN_FILE, "utf8"));
    if (alive(pid)) {
      log(`stopping the previous instance (process group ${pid})`);
      process.kill(-pid, "SIGTERM");
      for (let i = 0; i < 150 && alive(pid); i++) await sleep(100);
      if (alive(pid)) process.kill(-pid, "SIGKILL");
      for (let i = 0; i < 50 && (await answers(PORT)); i++) await sleep(100);
    }
  }
  rmSync(STATE, { recursive: true, force: true });
}

async function up() {
  if ((await answers(PORT)) || (await answers(PORT + 1)))
    throw new Error(`port ${PORT} or ${PORT + 1} is in use, and not by this script's instance`);
  mkdirSync(path.join(STATE, "uploads"), { recursive: true });
  writeFileSync(CLOCK_FILE, "0");

  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      /^(PATH|HOME|USER|LOGNAME|SHELL|LANG|LC_\w+|TZ|TMPDIR|TERM|NODE_EXTRA_CA_CERTS|SSL_CERT_FILE)$/.test(
        key,
      ),
    ),
  );
  const dotenv = path.join(REPO, ".env");
  if (existsSync(dotenv)) {
    for (const line of readFileSync(dotenv, "utf8").split("\n")) {
      const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
      if (match) env[match[1]] = "";
    }
  }
  Object.assign(env, {
    NODE_ENV: "development",
    PORT: String(PORT),
    ORIGIN: URL_BASE,
    RP_ID: "localhost",
    DATABASE_URL: `file:${STATE}/app.db`,
    AGENT_DB_PATH: path.join(STATE, "agent.db"),
    UPLOADS_DIR: path.join(STATE, "uploads"),
    TINY_AGENTS_FAUX: "1",
    AUTH_RATE_LIMIT_MAX: "1000",
    SECRETS_KEY: randomBytes(32).toString("base64"),
    ADMIN_AUTH_KEY: randomBytes(24).toString("hex"),
    SANDBOX_HOST: "",
    SHELLEY_URL: "",
    PORTLESS: "0",
    NODE_OPTIONS: "--max-old-space-size=1024",
    INBOX_CLOCK_FILE: CLOCK_FILE,
  });
  const out = openSync(path.join(STATE, "server.log"), "a");
  const child = spawn(
    path.join(REPO, "node_modules/.bin/tsx"),
    [
      "--import",
      path.join(import.meta.dirname, "inbox-register.mjs"),
      "apps/web/src/server/entry.node.ts",
    ],
    { cwd: REPO, env, detached: true, stdio: ["ignore", out, out] },
  );
  child.unref();
  writeFileSync(
    RUN_FILE,
    JSON.stringify(
      { pid: child.pid, port: PORT, url: URL_BASE, startedAt: new Date().toISOString() },
      null,
      2,
    ),
  );
  log(`started pid ${child.pid} on ${URL_BASE}, log data/verify/inbox/server.log`);

  for (let i = 0; ; i++) {
    if (!alive(child.pid))
      throw new Error("the server exited during boot; see data/verify/inbox/server.log");
    if (i > 240) throw new Error("the server was not ready after 240 s");
    const ready = await fetch(`${URL_BASE}/ready`)
      .then((r) => r.json())
      .catch(() => undefined);
    if (ready?.ready) break;
    await sleep(1000);
  }
}

let token;
async function call(method, url, body) {
  const res = await fetch(`${URL_BASE}/api/v1${url}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new Error(`${method} ${url} -> ${res.status} ${JSON.stringify(json).slice(0, 300)}`);
  return json.data ?? json;
}

async function until(what, check, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(250);
  }
}

async function setClockBack(ms) {
  writeFileSync(CLOCK_FILE, String(-ms));
  await until("the server clock", async () => {
    const { timestamp } = await fetch(`${URL_BASE}/health`).then((r) => r.json());
    return Math.abs(Date.now() - ms - Date.parse(timestamp)) < 5_000;
  });
}

const listEntry = async (id) => (await call("GET", "/bots")).find((bot) => bot.id === id);

function seedBotRow(id, fields) {
  const db = new DatabaseSync(path.join(STATE, "app.db"));
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    const cols = Object.keys(fields);
    db.prepare(`UPDATE bots SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`).run(
      ...cols.map((c) => fields[c]),
      id,
    );
  } finally {
    db.close();
  }
}

async function setupAccount() {
  token = (await call("POST", "/auth/setup", { ...LOGIN, name: "Ashik" })).token;
}

async function seedBots() {
  const model = (await call("GET", "/models")).models?.[0]?.id ?? "test-model";

  const ids = {};
  for (const bot of BOTS) {
    await setClockBack(bot.ago);
    const created = await call("POST", "/bots", {
      name: bot.name,
      description: bot.description,
      modelId: model,
    });
    ids[bot.key] = created.id;
    await call("POST", `/bots/${created.id}/messages`, {
      requestId: crypto.randomUUID(),
      text: bot.ask,
    });
    if (bot.waits) {
      await until(
        `${bot.name}'s approval card`,
        async () => (await listEntry(created.id)).approvals === 1,
      );
      seedBotRow(created.id, { last_message_preview: bot.preview });
    } else {
      await until(`${bot.name}'s reply`, async () => {
        const entry = await listEntry(created.id);
        return entry.lastMessagePreview?.startsWith(bot.preview) && !entry.replying;
      });
    }
    if (bot.key === "researcher") await call("POST", `/bots/${created.id}/read`);
    log(`seeded ${bot.name} (${bot.ago / MINUTE} min ago)`);
  }
  await setClockBack(0);
  const list = await call("GET", "/bots");
  const order = list.map((b) => b.name).join(", ");
  if (order !== "Code Buddy, Travel Planner, Chief of Staff, Researcher")
    throw new Error(`list order: ${order}`);
  const want = {
    "Code Buddy": "unread",
    "Travel Planner": "waiting",
    "Chief of Staff": "waiting",
    Researcher: "read",
  };
  for (const b of list) {
    const state =
      b.approvals > 0 ? "waiting" : b.unread ? "unread" : b.replying ? "replying" : "read";
    if (state !== want[b.name]) throw new Error(`${b.name} is ${state}, want ${want[b.name]}`);
  }
  return ids;
}

const results = [];
const messages = (page) => page.getByRole("region", { name: "Messages" });
const botsRegion = (page) => page.locator('section[aria-label="Bots"]').first();
const approvalCard = (page, botName, ask) =>
  page.locator('[data-slot="item"]').filter({ hasText: `${botName} wants to ${ask}` });

async function settle(page) {
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
}

async function assertClean(page) {
  const bad = await page.evaluate(() => {
    const text = document.body.innerText;
    const problems = [];
    if (/Echo:/.test(text)) problems.push("an Echo: reply");
    if (document.querySelector("[data-sonner-toast], vite-error-overlay"))
      problems.push("a toast or dev overlay");
    if (/Something went wrong|Failed to/i.test(text)) problems.push("an error message");
    return problems;
  });
  if (bad.length) throw new Error(`frame not clean: ${bad.join(", ")}`);
}

async function phoneScrollbars(page) {
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('[class~="[scrollbar-gutter:stable]"]')) {
      el.classList.remove("[scrollbar-gutter:stable]");
      el.classList.add("scrollbar-hide");
    }
  });
}

async function shoot(s, name) {
  await settle(s.page);
  await assertClean(s.page);
  await dumpCss(s.page, s.mode);
  for (let i = 0; i < 10; i++) {
    const focused = await s.page.evaluate(() => {
      document.activeElement?.blur?.();
      return document.activeElement !== document.body && document.activeElement !== null;
    });
    if (!focused) break;
    await s.page.waitForTimeout(200);
  }
  if (s.mode === "mobile") await phoneScrollbars(s.page);
  await snap(s, name);
  const diff = await verify(s.mode, name);
  results.push({ mode: s.mode, name, diff });
  log(`${s.mode}/${name}: verify ${diff.toFixed(5)}${diff < 0.003 ? "" : "  << OVER 0.003"}`);
}

async function openChat(s, id, lastLine, rows) {
  await s.page.goto(`/chats/${id}`, { waitUntil: "domcontentloaded" });
  await messages(s.page).getByText(lastLine, { exact: false }).last().waitFor({ timeout: 30_000 });
  if (s.mode === "desktop")
    await until(
      `${rows} sidebar rows`,
      async () => (await botsRegion(s.page).locator("li").count()) === rows,
    );
}

async function openList(s, rows) {
  await s.page.goto("/chats", { waitUntil: "domcontentloaded" });
  await until(
    `${rows} list rows`,
    async () => (await botsRegion(s.page).locator("li").count()) === rows,
  );
}

async function stageMode(mode) {
  const s = await open(mode, LOGIN);
  const { page } = s;
  try {
    await s.ctx.routeWebSocket(
      (url) => url.port === String(PORT + 1),
      () => {},
    );
    await page.goto("about:blank");
    const ids = await seedBots();
    log(`${mode}: start state seeded`);
    if (mode === "mobile") {
      await openList(s, 4);
      await shoot(s, "list-start");
    }

    for (const key of ["researcher", "travel", "chief", "code"]) {
      const name = {
        researcher: "side-researcher",
        travel: "side-travel",
        chief: "side-chief",
        code: "side-codebuddy",
      }[key];
      await openChat(s, ids[key], BY_KEY[key].last, 4);
      await shoot(s, name);
    }

    await openChat(s, ids.chief, BY_KEY.chief.last, 4);
    const card = approvalCard(page, "Chief of Staff", "create a new bot");
    await card.waitFor();
    await card.scrollIntoViewIfNeeded();
    await page.getByRole("button", { name: "Read more" }).waitFor();
    await shoot(s, "chief-pending");

    await card.getByRole("button", { name: "Approve", exact: true }).click();
    await messages(page).getByText(CHIEF_AFTER).waitFor({ timeout: 30_000 });
    if (mode === "desktop")
      await botsRegion(page).getByRole("link", { name: NEW_BOT, exact: true }).waitFor();
    await until(
      "Chief of Staff's turn to finish",
      async () => !(await api(page, "GET", "/bots")).find((b) => b.id === ids.chief).replying,
    );
    await messages(page).getByText(CHIEF_AFTER).scrollIntoViewIfNeeded();
    await shoot(s, "chief-approved");

    await setClockBack(BY_KEY.travel.ago);
    await openChat(s, ids.travel, BY_KEY.travel.last, 5);
    await approvalCard(page, "Travel Planner", "create a routine")
      .getByRole("button", { name: "Approve", exact: true })
      .click();
    await messages(page).getByText(TRAVEL_AFTER).waitFor({ timeout: 30_000 });
    await until("Travel Planner's turn to finish", async () => {
      const t = (await api(page, "GET", "/bots")).find((b) => b.id === ids.travel);
      return !t.replying && t.lastMessagePreview === TRAVEL_AFTER;
    });
    await setClockBack(0);
    const bots = await api(page, "GET", "/bots");
    const tracker = bots.find((b) => b.name === NEW_BOT);
    if (!tracker) throw new Error("Expense Tracker was not created");
    seedBotRow(tracker.id, { last_activity_at: Date.now() });
    for (const b of bots) await api(page, "POST", `/bots/${b.id}/read`);
    const end = await api(page, "GET", "/bots");
    if (end[0].name !== NEW_BOT || end.length !== 5)
      throw new Error(`end list: ${end.map((b) => b.name)}`);
    for (const b of end)
      if (b.unread || b.approvals || b.questions || b.replying)
        throw new Error(`${b.name} still needs attention`);

    await openChat(s, ids.researcher, BY_KEY.researcher.last, 5);
    await shoot(s, "side-end");
    if (mode === "mobile") {
      await openList(s, 5);
      await shoot(s, "list-end");
    }
  } finally {
    await s.browser.close();
  }
}

const args = process.argv.slice(2);
if (args.includes("--down")) {
  await down();
  process.exit(0);
}
const modes = args.filter((a) => a in SIZES);
for (const mode of modes.length ? modes : ["desktop", "mobile"]) {
  await down();
  await up();
  await setupAccount();
  await stageMode(mode);
}
log("results:");
for (const r of results) log(`  ${r.mode.padEnd(7)} ${r.name.padEnd(16)} ${r.diff.toFixed(5)}`);
log(`instance left running on ${URL_BASE} (stop it with --down)`);
if (results.some((r) => r.diff >= 0.003)) process.exitCode = 1;
