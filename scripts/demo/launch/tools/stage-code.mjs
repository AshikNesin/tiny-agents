#!/usr/bin/env node
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REPO = path.resolve(import.meta.dirname, "../../../..");
const PORT = 3150;
const URL_ = `http://localhost:${PORT}`;
const DIR = path.join(REPO, "data/verify/code");
const HOME = path.join(DIR, "home");
const CWD = path.join(HOME, "code/shop");
const RUN_FILE = path.join(DIR, "run.json");

process.env.TA_URL = URL_;
const { open, api, dumpCss, snap, verify } = await import("./snaplib.mjs");

const OWNER = { name: "Ashik", email: "demo@example.com", password: "demo@example.com" }; // gitleaks:allow
const BOT = { name: "Code Buddy", description: "Fixes bugs and ships code" };
const ASK = "The checkout test is flaky. Fix it and run the suite.";
const TITLE = "Fix flaky checkout test";
const ANSWER =
  "Fixed the flaky checkout test. The cart total was read before the price fetch resolved, so the test now awaits it. All 48 tests pass.";
const CLOSING = "Fixed. All 48 tests pass. The change is on branch fix/checkout-flake.";
const FOOTER = "Worked for 2m 14s · $0.31";

const log = (...args) => console.log("[stage-code]", ...args);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const portOpen = (port) =>
  new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    socket.once("connect", () => (socket.destroy(), resolve(true)));
    socket.once("error", () => resolve(false));
  });

async function stopOwn() {
  if (!existsSync(RUN_FILE)) return;
  const { pid } = JSON.parse(readFileSync(RUN_FILE, "utf8"));
  const ours = (() => {
    try {
      const environ = readFileSync(`/proc/${pid}/environ`, "utf8");
      return environ.includes(`STAGE_CODE_DIR=${DIR}`);
    } catch {
      return false;
    }
  })();
  if (!ours) return;
  log(`stopping the earlier instance (process group ${pid})`);
  try {
    process.kill(-pid, "SIGTERM");
  } catch {}
  const deadline = Date.now() + 15_000;
  while (alive(pid) && Date.now() < deadline) await sleep(250);
  if (alive(pid)) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {}
  }
  while ((await portOpen(PORT)) && Date.now() < deadline + 5_000) await sleep(250);
}

function serverEnv() {
  const safe = /^(PATH|HOME|USER|LOGNAME|SHELL|LANG|LC_\w+|TZ|TMPDIR|TERM)$/;
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => safe.test(key)));
  const blank = [
    "PUSHOVER_API_TOKEN",
    "PUSHOVER_USER_KEY",
    "CLOUDFLARE_API_KEY",
    "CLOUDFLARE_ACCOUNT_ID",
    "CLOUDFLARE_GATEWAY_ID",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "OPENROUTER_API_KEY",
    "GROQ_API_KEY",
    "MISTRAL_API_KEY",
    "AI_PROVIDERS",
    "DEFAULT_MODEL",
    "SENTRY_DSN",
    "SENTRY_AUTH_TOKEN",
    "SHELLEY_URL",
    "CLAUDE_CODE_ENGINE_ENABLED",
    "SANDBOX_HOST",
    "SANDBOX_PORT",
    "SANDBOX_USER",
    "SANDBOX_SSH_KEY_FILE",
    "DATA_DIR",
  ];
  for (const key of blank) env[key] = "";
  const dotenv = path.join(REPO, ".env");
  if (existsSync(dotenv)) {
    for (const line of readFileSync(dotenv, "utf8").split("\n")) {
      const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
      if (match) env[match[1]] = "";
    }
  }
  return {
    ...env,
    NODE_ENV: "development",
    PORT: String(PORT),
    ORIGIN: URL_,
    RP_ID: "localhost",
    DATABASE_URL: `file:${DIR}/app.db`,
    AGENT_DB_PATH: path.join(DIR, "agent.db"),
    UPLOADS_DIR: path.join(DIR, "uploads"),
    TINY_AGENTS_FAUX: "1",
    TINY_AGENTS_FAUX_TOKENS_PER_SECOND: "80",
    AUTH_RATE_LIMIT_MAX: "1000",
    SECRETS_KEY: randomBytes(32).toString("base64"),
    ADMIN_AUTH_KEY: randomBytes(24).toString("hex"),
    PORTLESS: "0",
    NODE_OPTIONS: "--max-old-space-size=1024",
    STAGE_CODE_DIR: DIR,
    STAGE_CODE_CWD: CWD,
  };
}

export async function boot() {
  await stopOwn();
  for (const port of [PORT, PORT + 1]) {
    if (await portOpen(port)) throw new Error(`port ${port} is in use by something else`);
  }
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(CWD, { recursive: true });
  setGate(1);
  const tsx = path.join(REPO, "node_modules/.bin/tsx");
  const out = openSync(path.join(DIR, "server.log"), "a");
  const child = spawn(
    tsx,
    [
      "--import",
      path.join(import.meta.dirname, "stage-code-server/preload.mjs"),
      "apps/web/src/server/entry.node.ts",
    ],
    { cwd: REPO, env: serverEnv(), detached: true, stdio: ["ignore", out, out] },
  );
  child.unref();
  writeFileSync(RUN_FILE, JSON.stringify({ pid: child.pid, url: URL_, startedAt: new Date() }));
  log(`started pid ${child.pid}, log data/verify/code/server.log`);
  const deadline = Date.now() + 240_000;
  for (;;) {
    if (!alive(child.pid)) throw new Error("the server exited during boot; see server.log");
    const ready = await fetch(`${URL_}/ready`)
      .then((res) => res.json())
      .catch(() => undefined);
    if (ready?.ready) break;
    if (Date.now() > deadline) throw new Error("not ready after 240s; see server.log");
    await sleep(1000);
  }
  const res = await fetch(`${URL_}/api/v1/auth/setup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(OWNER),
  });
  if (!res.ok) throw new Error(`setup -> ${res.status} ${await res.text()}`);
  log(`ready at ${URL_}`);
}

function setGate(step) {
  writeFileSync(path.join(DIR, "gate"), String(step));
}

const CAST_CWD = "~/code/shop";

async function until(what, check, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await check().catch(() => undefined);
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(250);
  }
}

async function castCwd(page) {
  return page.evaluate(
    ({ real, cast }) => {
      let edits = 0;
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const next = node.nodeValue.replaceAll(real, cast).replaceAll("…/code/shop", cast);
        if (next !== node.nodeValue) {
          node.nodeValue = next;
          edits++;
        }
      }
      for (const el of document.querySelectorAll("[title]")) {
        const title = el.getAttribute("title");
        if (title.includes(real)) {
          el.setAttribute("title", title.replaceAll(real, cast));
          edits++;
        }
      }
      return edits;
    },
    { real: CWD, cast: CAST_CWD },
  );
}

async function setOpen(trigger, open = true) {
  await trigger.waitFor();
  if ((await trigger.getAttribute("aria-expanded")) !== String(open)) {
    await trigger.evaluate((el) => el.click());
  }
  await until(
    "the row to toggle",
    async () => (await trigger.getAttribute("aria-expanded")) === String(open),
    5_000,
  );
}

const results = [];

async function stillOpenRows(page) {
  return page.evaluate(() => {
    let edits = 0;
    for (const box of document.querySelectorAll('[role="region"][aria-label="Messages"]')) {
      if (!box.scrollTop) continue;
      for (const el of box.querySelectorAll(
        '[data-slot="trace-collapsible-content"][data-state="open"]',
      )) {
        if (el.classList.contains("data-open:animate-accordion-down")) {
          el.classList.remove("data-open:animate-accordion-down");
          edits++;
        }
      }
      for (const el of box.querySelectorAll('[data-slot="message-scroller-item"]')) {
        el.style.containIntrinsicSize = `auto ${el.getBoundingClientRect().height}px`;
        edits++;
      }
    }
    return edits;
  });
}

async function phoneGutter(page) {
  return page.evaluate(() => {
    let edits = 0;
    for (const el of document.querySelectorAll('[data-slot="message-scroller-viewport"]')) {
      if (!el.classList.contains("[scrollbar-gutter:stable]")) continue;
      el.classList.replace("[scrollbar-gutter:stable]", "scrollbar-hide");
      edits++;
    }
    return edits;
  });
}

const edits = [];

async function shoot(session, name, { css = false } = {}) {
  const cwdEdits = await castCwd(session.page);
  const stillEdits = await stillOpenRows(session.page);
  const gutterEdits = session.mode === "mobile" ? await phoneGutter(session.page) : 0;
  edits.push({ mode: session.mode, name, cwdEdits, stillEdits, gutterEdits });
  await session.page.evaluate(() => document.activeElement?.blur?.());
  if (css) await dumpCss(session.page, session.mode);
  await snap(session, name);
  const diff = await verify(session.mode, name);
  results.push({ mode: session.mode, name, diff });
  log(
    `${session.mode}/${name}: verify ${diff.toFixed(5)}${diff < 0.003 ? "" : "  <-- over 0.003"}`,
  );
}

async function reveal(page, target) {
  await target.evaluate((el) => {
    let box = el.parentElement;
    while (
      box &&
      !(box.scrollHeight > box.clientHeight && /auto|scroll/.test(getComputedStyle(box).overflowY))
    )
      box = box.parentElement;
    if (!box) return;
    const r = el.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    const delta = r.height <= b.height - 16 ? r.bottom - b.bottom + 16 : r.top - b.top - 8;
    box.scrollTop = Math.max(
      0,
      Math.min(box.scrollHeight - box.clientHeight, box.scrollTop + delta),
    );
  });
  await page.waitForTimeout(200);
}

async function scrollToEnd(page, target) {
  await target.evaluate((el) => {
    let box = el;
    while (
      box &&
      !(box.scrollHeight > box.clientHeight && /auto|scroll/.test(getComputedStyle(box).overflowY))
    )
      box = box.parentElement;
    if (box) box.scrollTop = box.scrollHeight;
  });
  await page.waitForTimeout(200);
}

async function stageMode(mode) {
  await boot();
  const session = await open(mode, { email: OWNER.email, password: OWNER.password });
  const { page } = session;
  await session.ctx.route(/^https:\/\/feedbackbee\.nesin\.io\//, (route) => route.abort());
  await session.ctx.routeWebSocket(new RegExp(`^wss?://[^/]+:${PORT + 1}(/|$)`), (ws) => {
    const server = ws.connectToServer();
    server.onMessage((message) => {
      if (typeof message === "string" && message.includes('"full-reload"')) return;
      ws.send(message);
    });
    ws.onMessage((message) => server.send(message));
  });
  try {
    const { models } = await api(page, "GET", "/models");
    const modelId = models?.[0]?.id;
    if (!modelId) throw new Error("no model listed");
    const bot = await api(page, "POST", "/bots", { ...BOT, modelId });
    const entry = async () => (await api(page, "GET", "/bots")).find((b) => b.id === bot.id);

    await page.goto(`/chats/${bot.id}`);
    const composer = page.getByPlaceholder(/(?:ask|message) Code Buddy/i);
    await composer.fill(ASK);
    await page.getByRole("button", { name: /^send/i }).click();

    const card = page.getByTestId("code-handoff");
    await card.waitFor({ timeout: 60_000 });
    const thread = await until("the Claude Code thread", async () =>
      (await api(page, "GET", "/code/threads")).find((t) => t.id.startsWith("claude-code:")),
    );
    await api(page, "POST", `/code/threads/${encodeURIComponent(thread.id)}/rename`, {
      title: TITLE,
    });
    await until("Code Buddy's turn to end", async () => !(await entry()).replying);
    await card.getByText(TITLE, { exact: true }).waitFor();
    await card
      .getByRole("status", { name: "Working" })
      .or(card.getByLabel("Working"))
      .first()
      .waitFor();
    await page.waitForLoadState("networkidle").catch(() => {});
    await shoot(session, "codebuddy-handoff", { css: true });

    await page.goto(`/code/t/${encodeURIComponent(thread.id)}`);
    const transcript = page.getByRole("region", { name: "Messages" });
    await transcript.getByText(ASK, { exact: true }).waitFor();

    setGate(2);
    const bashFail = transcript.getByRole("button", { name: /pnpm test checkout/ });
    await bashFail.waitFor({ timeout: 30_000 });
    await until(
      "the failing run to finish",
      async () => (await bashFail.locator('[data-status="error"]').count()) > 0,
    );
    await setOpen(bashFail, true);
    await transcript.getByText("Tests  1 failed | 5 passed (6)").waitFor();
    await reveal(page, bashFail.locator("xpath=ancestor::*[@data-slot='trace-collapsible'][1]"));
    await shoot(session, "code-running-fail", { css: true });

    setGate(3);
    const group = transcript.getByTestId("code-tool-group");
    const groupTrigger = group.locator('[data-slot="trace-collapsible-trigger"]').first();
    await groupTrigger.waitFor({ timeout: 30_000 });
    await setOpen(groupTrigger, true);
    const edit = group.getByRole("button", { name: /checkout\.test\.ts/ });
    const bashFailIn = group.getByRole("button", { name: /pnpm test checkout/ });
    await setOpen(bashFailIn, false);
    await setOpen(edit, true);
    await group.getByText('await screen.findByText("Price loaded");').first().waitFor();
    await reveal(page, group);
    await shoot(session, "code-running-diff");

    setGate(4);
    const bashPass = group.getByRole("button", { name: /^\S*\s*pnpm test$/ });
    await bashPass.waitFor({ timeout: 30_000 });
    await until(
      "the passing run to finish",
      async () => (await bashPass.locator('[data-status="running"]').count()) === 0,
    );
    await setOpen(edit, false);
    await setOpen(bashPass, true);
    await group.getByText("Tests  48 passed (48)").waitFor();
    await reveal(page, group);
    await shoot(session, "code-running-pass");

    setGate(5);
    await transcript.getByText(FOOTER).waitFor({ timeout: 30_000 });
    await page.reload();
    await transcript.getByText(FOOTER).waitFor();
    await page.waitForLoadState("networkidle").catch(() => {});
    await scrollToEnd(page, transcript.getByText(FOOTER));
    await shoot(session, "code-done");

    await setOpen(groupTrigger, true);
    for (const row of [bashFailIn, edit, bashPass]) await setOpen(row, true);
    await scrollToEnd(page, transcript.getByText(FOOTER));
    await shoot(session, "code-done-open");

    await page.goto(mode === "mobile" ? "/code" : `/code/t/${encodeURIComponent(thread.id)}`);
    const list = page.getByRole("navigation", { name: "Code threads" });
    await list.getByRole("link", { name: new RegExp(`^${TITLE}`) }).waitFor();
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(500);
    await shoot(session, "code-list", { css: true });

    await until(
      "the closing line",
      async () => (await entry()).lastMessagePreview?.startsWith("Fixed. All 48"),
      60_000,
    );
    await until("Code Buddy's turn to end", async () => !(await entry()).replying);
    await page.goto(`/chats/${bot.id}`);
    await page
      .getByRole("region", { name: "Messages" })
      .getByText(CLOSING, { exact: true })
      .waitFor();
    await page.waitForLoadState("networkidle").catch(() => {});
    await shoot(session, "codebuddy-chat", { css: true });
  } finally {
    await session.browser.close();
  }
}

export {
  open,
  api,
  dumpCss,
  snap,
  verify,
  setGate,
  URL_,
  DIR,
  CWD,
  BOT,
  ASK,
  TITLE,
  ANSWER,
  CLOSING,
  FOOTER,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.includes("--boot")) {
    await boot();
  } else {
    const modes = args.filter((a) => a === "desktop" || a === "mobile");
    for (const mode of modes.length ? modes : ["desktop", "mobile"]) await stageMode(mode);
    console.table(
      results.map((r) => ({ ...r, diff: Number(r.diff.toFixed(5)), ok: r.diff < 0.003 })),
    );
    console.table(edits);
    log(`left running at ${URL_} (data/verify/code)`);
    if (results.some((r) => r.diff >= 0.003)) process.exitCode = 1;
  }
}
