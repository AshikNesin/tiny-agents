#!/usr/bin/env node
import { spawn, execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";

const PORT = 3140;
const FLIGHTS_PORT = 3145;
const SSH_PORT = 2240;
const URL_BASE = `http://localhost:${PORT}`;
process.env.TA_URL = URL_BASE;
process.env.TZ = "Asia/Kolkata";
const { open, api, dumpCss, snap, verify } = await import("./snaplib.mjs");
const D = await import("./travel-director.mjs");

const REPO = path.resolve(import.meta.dirname, "../../../..");
const STATE = path.join(REPO, "data/verify/travel");
const VM = path.join(REPO, "data/verify/travel-vm");
const RUN_FILE = path.join(STATE, "run.json");
const VM_USER = "travelvm";
const OWNER = { email: "demo@example.com", password: "demo@example.com" }; // gitleaks:allow
const GUEST = { email: "sonaal@example.com", password: "sonaal@example.com", name: "Sonaal" }; // gitleaks:allow
const IST = 5.5 * 3600_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...parts) => console.log("[stage-travel]", ...parts);

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const owns = (pid, marker) => {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, "utf8").includes(marker);
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

async function stopGroup(pid, marker) {
  if (!pid || !alive(pid)) return;
  if (!owns(pid, marker)) return log(`pid ${pid} is not ours; not killing it`);
  try {
    process.kill(-pid, "SIGTERM");
  } catch {}
  for (let i = 0; i < 150 && alive(pid); i++) await sleep(100);
  if (alive(pid)) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {}
  }
}

async function down() {
  if (existsSync(RUN_FILE)) {
    const run = JSON.parse(readFileSync(RUN_FILE, "utf8"));
    log(`stopping the previous instance (process group ${run.pid})`);
    await stopGroup(run.pid, "travel-register.mjs");
    await stopGroup(run.flightsPid, "travel-flights.mjs");
    for (let i = 0; i < 50 && (await answers(PORT)); i++) await sleep(100);
  }
  try {
    execFileSync("pkill", ["-KILL", "-u", VM_USER]);
  } catch {}
  rmSync(STATE, { recursive: true, force: true });
  rmSync(`/home/${VM_USER}/data`, { recursive: true, force: true });
  rmSync(`/home/${VM_USER}/.config`, { recursive: true, force: true });
  rmSync(`/home/${VM_USER}/.cache`, { recursive: true, force: true });
  teardownVm();
}

const sh = (cmd) =>
  execFileSync("bash", ["-c", cmd], { stdio: ["ignore", "pipe", "inherit"] }).toString();

function teardownVm() {
  sh(`rm -f /etc/sudoers.d/${VM_USER} || true`);
  sh(`kill $(cat /run/sshd-travel.pid 2>/dev/null) 2>/dev/null || true`);
  sh(`userdel -r ${VM_USER} 2>/dev/null || true`);
}

function setupVm() {
  for (const bin of [
    "sshd",
    "Xtigervnc",
    "google-chrome-stable",
    "xdotool",
    "startxfce4",
    "tmux",
    "openssl",
  ]) {
    if (!sh(`command -v ${bin} || true`).trim())
      throw new Error(`${bin} is missing: the stand-in VM needs it`);
  }
  mkdirSync(VM, { recursive: true });
  if (!sh(`id -u ${VM_USER} 2>/dev/null || true`).trim()) sh(`useradd -m -s /bin/bash ${VM_USER}`);
  sh(
    `passwd -l ${VM_USER} >/dev/null; echo "${VM_USER} ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/${VM_USER}; chmod 440 /etc/sudoers.d/${VM_USER}`,
  );
  if (!existsSync(path.join(VM, "id_ed25519")))
    sh(`ssh-keygen -q -t ed25519 -N "" -f ${VM}/id_ed25519`);
  if (!existsSync(path.join(VM, "ssh_host_ed25519_key")))
    sh(`ssh-keygen -q -t ed25519 -N "" -f ${VM}/ssh_host_ed25519_key`);
  writeFileSync(path.join(VM, "authorized_keys"), readFileSync(path.join(VM, "id_ed25519.pub")));
  chmodSync(path.join(VM, "authorized_keys"), 0o644);
  if (!existsSync(path.join(VM, "flights.crt"))) {
    sh(
      `openssl req -x509 -newkey rsa:2048 -nodes -days 60 -subj "/CN=flights.example.com" ` +
        `-addext "subjectAltName=DNS:flights.example.com" -keyout ${VM}/flights.key -out ${VM}/flights.crt 2>/dev/null`,
    );
  }
  const spki = sh(
    `openssl x509 -in ${VM}/flights.crt -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | base64`,
  ).trim();
  const bin = `/home/${VM_USER}/bin`;
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    `${bin}/google-chrome-stable`,
    `#!/bin/sh
# Staging only (scripts/demo/launch/tools/stage-travel.mjs): the sandbox user's Chrome.
# No sandbox inside a container; flights.example.com is the local sample page.
exec /usr/bin/google-chrome-stable --no-sandbox --test-type --no-first-run --disable-features=Translate \\
  "--host-resolver-rules=MAP flights.example.com 127.0.0.1:${FLIGHTS_PORT}" \\
  "--ignore-certificate-errors-spki-list=${spki}" "$@"
`,
  );
  chmodSync(`${bin}/google-chrome-stable`, 0o755);
  const markers = `/home/${VM_USER}/.tiny-agents`;
  mkdirSync(markers, { recursive: true });
  const version = (file, name) =>
    readFileSync(path.join(REPO, "packages/sandbox/src", file), "utf8").match(
      new RegExp(`export const ${name} = "([^"]+)"`),
    )[1];
  writeFileSync(`${markers}/browser-stack-${version("browser-vm-setup.ts", "STACK_VERSION")}`, "");
  writeFileSync(
    `${markers}/computer-stack-${version("computer-vm-setup.ts", "COMPUTER_STACK_VERSION")}`,
    "",
  );
  sh(
    `chown -R ${VM_USER}:${VM_USER} /home/${VM_USER}; mkdir -p /tmp/.X11-unix /run/sshd && chmod 1777 /tmp/.X11-unix`,
  );
  writeFileSync(
    path.join(VM, "sshd_config"),
    `Port ${SSH_PORT}
ListenAddress 127.0.0.1
HostKey ${VM}/ssh_host_ed25519_key
AuthorizedKeysFile ${VM}/authorized_keys
AllowUsers ${VM_USER}
PermitRootLogin no
PubkeyAuthentication yes
PasswordAuthentication no
KbdInteractiveAuthentication no
UsePAM no
StrictModes no
AllowTcpForwarding local
X11Forwarding no
PrintMotd no
AcceptEnv LANG LC_*
SetEnv PATH=/home/${VM_USER}/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
Subsystem sftp internal-sftp
PidFile /run/sshd-travel.pid
`,
  );
  const pidFile = "/run/sshd-travel.pid";
  const running = existsSync(pidFile) && alive(Number(readFileSync(pidFile, "utf8")));
  if (!running) sh(`$(command -v sshd) -f ${VM}/sshd_config`);
  sh(
    `ssh -i ${VM}/id_ed25519 -p ${SSH_PORT} -o BatchMode=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ${VM_USER}@127.0.0.1 true 2>/dev/null`,
  );
}

function clockOffset(lead) {
  const at = Date.now() + lead;
  const ist = new Date(at + IST);
  const target =
    Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), 6, 59, 20) - IST;
  return target - at;
}

async function up() {
  if ((await answers(PORT)) || (await answers(PORT + 1)))
    throw new Error(`port ${PORT} or ${PORT + 1} is in use, and not by this script's instance`);
  mkdirSync(path.join(STATE, "uploads"), { recursive: true });
  const out = openSync(path.join(STATE, "server.log"), "a");

  const flights = spawn(
    process.execPath,
    [
      path.join(import.meta.dirname, "travel-flights.mjs"),
      String(FLIGHTS_PORT),
      `${VM}/flights.crt`,
      `${VM}/flights.key`,
    ],
    { detached: true, stdio: ["ignore", out, out] },
  );
  flights.unref();

  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      /^(PATH|HOME|USER|LOGNAME|SHELL|LANG|LC_\w+|TMPDIR|TERM|NODE_EXTRA_CA_CERTS|SSL_CERT_FILE)$/.test(
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
  const offset = clockOffset(20_000);
  Object.assign(env, {
    TZ: "UTC",
    NODE_ENV: "development",
    PORT: String(PORT),
    ORIGIN: URL_BASE,
    RP_ID: "localhost",
    DATABASE_URL: `file:${STATE}/app.db`,
    AGENT_DB_PATH: path.join(STATE, "agent.db"),
    UPLOADS_DIR: path.join(STATE, "uploads"),
    TINY_AGENTS_FAUX: "1",
    TINY_AGENTS_FAUX_TOKENS_PER_SECOND: "40",
    AUTH_RATE_LIMIT_MAX: "1000",
    SECRETS_KEY: randomBytes(32).toString("base64"),
    ADMIN_AUTH_KEY: randomBytes(24).toString("hex"),
    SANDBOX_HOST: "127.0.0.1",
    SANDBOX_PORT: String(SSH_PORT),
    SANDBOX_USER: VM_USER,
    SANDBOX_SSH_KEY_FILE: path.join(VM, "id_ed25519"),
    BROWSER_SCALE: "1",
    SHELLEY_URL: "",
    PORTLESS: "0",
    NODE_OPTIONS: "--max-old-space-size=1024",
    TRAVEL_CLOCK_OFFSET_MS: String(offset),
    TRAVEL_DIRECTOR_LOG: path.join(STATE, "director.log"),
  });
  const child = spawn(
    path.join(REPO, "node_modules/.bin/tsx"),
    [
      "--import",
      path.join(import.meta.dirname, "travel-register.mjs"),
      "apps/web/src/server/entry.node.ts",
    ],
    { cwd: REPO, env, detached: true, stdio: ["ignore", out, out] },
  );
  child.unref();
  writeFileSync(
    RUN_FILE,
    JSON.stringify(
      {
        pid: child.pid,
        flightsPid: flights.pid,
        port: PORT,
        url: URL_BASE,
        clockOffsetMs: offset,
        startedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  log(
    `started pid ${child.pid} on ${URL_BASE} (clock ${Math.round(offset / 60_000)} min ahead), log data/verify/travel/server.log`,
  );

  for (let i = 0; ; i++) {
    if (!alive(child.pid))
      throw new Error("the server exited during boot; see data/verify/travel/server.log");
    if (i > 240) throw new Error("the server was not ready after 240 s");
    const ready = await fetch(`${URL_BASE}/ready`)
      .then((r) => r.json())
      .catch(() => undefined);
    if (ready?.ready) break;
    await sleep(1000);
  }
  return offset;
}

let token;
async function call(method, url, body, headers = {}) {
  const res = await fetch(`${URL_BASE}/api/v1${url}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new Error(`${method} ${url} -> ${res.status} ${JSON.stringify(json).slice(0, 300)}`);
  return json.data ?? json;
}

async function until(what, check, timeout = 90_000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await check().catch(() => undefined);
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(500);
  }
}

const botEntry = async (id) => (await call("GET", "/bots")).find((bot) => bot.id === id);

async function seed() {
  token = (await call("POST", "/auth/setup", { ...OWNER, name: "Ashik" })).token;
  const guest = await call("POST", "/people", GUEST);
  const model = (await call("GET", "/models")).models?.[0]?.id;
  const bot = await call("POST", "/bots", {
    name: "Travel Planner",
    description: "Plans trips and watches fares",
    modelId: model,
    guestIds: [guest.id],
    toolPermissions: { browser_navigate: "allow" },
  });
  const stepUp = (await call("POST", "/vault/step-up", { password: OWNER.password })).token;
  await call(
    "POST",
    "/vault/items",
    {
      kind: "card",
      title: "Visa",
      urls: ["https://flights.example.com"],
      values: {
        card_number: "4242424242424242",
        card_expiry: "12/29",
        card_cvc: "123",
        card_holder: "Ashik",
      }, // gitleaks:allow
      policy: { handle: "visa", origins: ["https://flights.example.com"], bots: [bot.id] },
    },
    { "x-vault-step-up": stepUp },
  );
  const routine = await call("POST", "/routines", {
    botId: bot.id,
    name: "Morning fare check",
    prompt: D.ROUTINE_PROMPT,
    schedule: { kind: "cron", expr: "0 7 * * *" },
  });
  log(
    "seeded the account, Sonaal, Travel Planner, the card and the routine; waiting for 7:00 AM IST",
  );

  const run = await until(
    "the routine's 7:00 AM run",
    async () => {
      const runs = await call("GET", `/routines/${routine.id}/runs`);
      const list = runs.runs ?? runs;
      const done = list.find((r) => r.status !== "awaiting" && r.status !== "running");
      return done;
    },
    180_000,
  );
  if (run.status !== "succeeded")
    throw new Error(`the routine run ended ${run.status}: ${JSON.stringify(run).slice(0, 400)}`);
  log("the routine ran:", run.status);

  await call("POST", `/bots/${bot.id}/messages`, {
    requestId: crypto.randomUUID(),
    text: D.BOOK_TRIGGER,
  });
  await until("the vault approval", async () => (await botEntry(bot.id)).approvals === 1, 120_000);
  log("the vault card is waiting");
  return { bot, guest, routine };
}

const sessions = [];
async function openAt(mode, offset, login) {
  const session = await open(mode, login);
  sessions.push(session);
  await session.ctx.addInitScript((port) => {
    const Real = window.WebSocket;
    window.WebSocket = new Proxy(Real, {
      construct(target, args) {
        if (String(args[0]).includes(`:${port}/`)) args = ["ws://127.0.0.1:9/", ...args.slice(1)];
        return Reflect.construct(target, args);
      },
    });
  }, PORT + 1);
  await session.page.clock.install({ time: new Date(Date.now() + offset) });
  return session;
}

async function gotoChat({ page }, botId) {
  await page.goto(`/chats/${botId}`, { waitUntil: "domcontentloaded" });
  await page.getByText(D.FARE_LINE).first().waitFor();
}

async function hideTrigger(page) {
  const n = await page.evaluate((trigger) => {
    let hidden = 0;
    for (const el of document.querySelectorAll("[data-message-id], [data-testid^='message']")) {
      if (el.textContent?.includes(trigger)) {
        el.setAttribute("hidden", "");
        hidden++;
      }
    }
    return hidden;
  }, D.BOOK_TRIGGER);
  if (n === 0) log("WARN: the trigger message was not found to hide");
}

const results = [];
async function shoot(session, name) {
  if (only && !only.includes(name)) return log(`skipped ${session.mode}/${name} (--only)`);
  await hideTrigger(session.page);
  await dumpCss(session.page, session.mode);
  await snap(session, name);
  results.push([session.mode, name]);
  log(`snapped ${session.mode}/${name}`);
}

async function stage(mode) {
  log(`── ${mode} ──`);
  await down();
  setupVm();
  const offset = await up();
  const { bot } = await seed();
  if (args.includes("--seed")) return;

  const owner = await openAt(mode, offset, OWNER);
  const { page } = owner;
  await gotoChat(owner, bot.id);
  const card = page
    .locator("[data-slot=item]")
    .filter({ hasText: "Travel Planner wants to fill Visa ••4242" })
    .first();
  await card.waitFor();
  const panel = page.getByTestId("browser-panel");
  if (await panel.isVisible().catch(() => false))
    await page.getByRole("button", { name: "Close browser panel" }).click();
  await shoot(owner, "travel-waiting");

  await page.getByTestId("live-view-toggle").click();
  await panel.waitFor();
  const take = page.getByTestId("browser-takeover");
  await take.waitFor({ timeout: 60_000 });
  if (mode === "desktop") await take.hover();
  await page.waitForTimeout(600);
  await shoot(owner, "travel-live");

  await take.click();
  await page.getByTestId("browser-driving-frame").waitFor();
  await page.mouse.move(0, 0);
  await page.waitForTimeout(600);
  await shoot(owner, "travel-driving");
  await page.getByRole("button", { name: "Hand back", exact: true }).click();
  await take.waitFor();

  await page.getByTestId("live-view-tab-computer").click();
  const computer = page.getByTestId("computer-panel");
  await computer.waitFor();
  const start = page.getByTestId("computer-open");
  const live = page.getByTestId("computer-takeover");
  await start.or(live).first().waitFor({ timeout: 30_000 });
  if (await start.isVisible()) await start.click();
  await live.waitFor({ timeout: 180_000 });
  await page.mouse.move(0, 0);
  await page.waitForTimeout(1500);
  await shoot(owner, "travel-computer");
  await page.getByRole("button", { name: "Close computer panel" }).click();

  await card.getByRole("button", { name: "Approve once" }).click();
  await until(
    "the approval to settle",
    async () => (await botEntry(bot.id)).approvals === 0 && !(await botEntry(bot.id)).replying,
  );
  if (await panel.isVisible().catch(() => false))
    await page.getByRole("button", { name: "Close browser panel" }).click();
  await page.waitForTimeout(800);
  await shoot(owner, "travel-approved");

  await api(page, "POST", `/bots/${bot.id}/messages`, {
    requestId: crypto.randomUUID(),
    text: D.ASHIK_SHARED,
  });
  await until("the bot to pass", async () => !(await botEntry(bot.id)).replying);
  const guest = await openAt(mode, offset, GUEST);
  await gotoChat(guest, bot.id);
  await api(guest.page, "POST", `/bots/${bot.id}/messages`, {
    requestId: crypto.randomUUID(),
    text: D.SONAAL_SHARED,
  });
  await page.getByText(D.SEATS_LINE).waitFor({ timeout: 60_000 });
  await guest.page.getByText(D.SEATS_LINE).waitFor({ timeout: 60_000 });
  await page.waitForTimeout(800);
  await shoot(owner, "travel-shared-ashik");
  await guest.page.waitForTimeout(800);
  await shoot(guest, "travel-shared-sonaal");
  await guest.browser.close();
  await owner.browser.close();
}

const args = process.argv.slice(2);
const onlyAt = args.indexOf("--only");
const only = onlyAt >= 0 ? args.splice(onlyAt, 2)[1].split(",") : null;
if (args.includes("--down")) {
  await down();
  process.exit(0);
}
const modes = ["desktop", "mobile"].filter(
  (m) => !args.some((a) => !a.startsWith("--")) || args.includes(m),
);
for (const mode of modes) {
  try {
    await stage(mode);
  } catch (error) {
    for (const s of sessions)
      await s.page
        .screenshot({ path: path.join(STATE, `failure-${s.mode}-${sessions.indexOf(s)}.png`) })
        .catch(() => {});
    throw error;
  }
}

if (results.length) {
  log("verify:");
  let bad = 0;
  for (const [mode, name] of results) {
    const diff = await verify(mode, name);
    if (diff >= 0.003) bad++;
    log(`  ${mode}/${name}: ${diff.toFixed(5)}${diff >= 0.003 ? "  FAIL" : ""}`);
  }
  if (bad) process.exitCode = 1;
}
log("done; the instance is left running on", URL_BASE);
