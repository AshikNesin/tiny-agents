#!/usr/bin/env node
/**
 * ta-verify: launch, health-check, drive and tear down one isolated
 * tiny-agents instance for verification.
 *
 *   ta-verify up [--port 3100] [--run <id>] [--sandbox] [--empty]
 *                                             start a fresh instance (own DBs, faux model)
 *       --sandbox  point it at the local sandbox container (`pnpm sandbox:up`):
 *                  terminal, computer, browser and bot sandbox tools become reachable
 *       --empty    skip the demo-user seed (no users: first-run /setup is reachable)
 *       --shelley  start a keyless Shelley (`-predictable-only`) for this run and set
 *                  SHELLEY_URL, so /code and bots' code_* tools are reachable. Binary:
 *                  $TA_VERIFY_SHELLEY_BIN, else `shelley` on PATH, else copied out of
 *                  the local sandbox container (`pnpm sandbox:up`)
 *   ta-verify doctor [--run <id>]             read-only "is this instance worth driving?"
 *   ta-verify drive <journey.mjs>... [--run <id>]  run journeys against the instance
 *   ta-verify down [--run <id>]               stop what `up` started, delete its state, keep evidence
 *   ta-verify status                          list runs this checkout knows about
 *
 * State:    <repo>/data/verify/<run>/          (app.db, agent.db, uploads, server.log, run.json)
 * Evidence: <repo>/data/verify-evidence/<run>/ (survives `down`)
 * Both live under the git-ignored `data/`.
 */
import { spawn, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import net from "node:net";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  openSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = execFileSync("git", ["-C", SKILL_DIR, "rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();
const RUNS = path.join(REPO, "data", "verify");
const EVIDENCE = path.join(REPO, "data", "verify-evidence");
const CURRENT = path.join(RUNS, "current");
const DEMO = { email: "demo@example.com", password: "demo@example.com" }; // gitleaks:allow (documented dev-only demo account)

const [command, ...rest] = process.argv.slice(2);
const flags = {};
const positional = [];
const BOOLEAN_FLAGS = new Set(["sandbox", "empty", "shelley"]);
for (let i = 0; i < rest.length; i++) {
  const name = rest[i].slice(2);
  if (rest[i].startsWith("--") && BOOLEAN_FLAGS.has(name)) flags[name] = true;
  else if (rest[i].startsWith("--")) flags[name] = rest[++i];
  else positional.push(rest[i]);
}

const log = (msg) => console.log(`[ta-verify] ${msg}`);
const fail = (msg) => {
  console.error(`[ta-verify] FAIL: ${msg}`);
  process.exit(1);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Paths whose changes the running instance would not pick up. */
const APP_PATHS = [
  "apps",
  "packages",
  "scripts",
  "vite.config.ts",
  "package.json",
  "pnpm-lock.yaml",
  "drizzle.config.ts",
  "tsconfig.base.json",
];

/** App files that differ between the launch revision and the working tree (committed or not). */
function appChangesSince(revision) {
  try {
    const out = execFileSync(
      "git",
      ["-C", REPO, "diff", "--name-only", revision, "--", ...APP_PATHS],
      {
        encoding: "utf8",
      },
    );
    return out.split("\n").filter(Boolean);
  } catch {
    return [`(git diff against ${revision} failed)`];
  }
}

const head = () =>
  execFileSync("git", ["-C", REPO, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();

function runId() {
  if (flags.run) return flags.run;
  if (process.env.TA_VERIFY_RUN) return process.env.TA_VERIFY_RUN;
  if (existsSync(CURRENT)) return readFileSync(CURRENT, "utf8").trim();
  fail("no run given and no current run; start one with `ta-verify up`");
}

function readRun(id) {
  const file = path.join(RUNS, id, "run.json");
  if (!existsSync(file)) fail(`run ${id} has no state at ${file}`);
  return JSON.parse(readFileSync(file, "utf8"));
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** PIDs listening on the port, via lsof (Linux and macOS). null when lsof is missing. */
function listeners(port) {
  try {
    const out = execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.split("\n").filter(Boolean).map(Number);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    return []; // lsof exits 1 when nothing listens
  }
}

function pgidOf(pid) {
  try {
    return Number(
      execFileSync("ps", ["-o", "pgid=", "-p", String(pid)], { encoding: "utf8" }).trim(),
    );
  } catch {
    return undefined;
  }
}

async function getJson(url, init) {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(5000) });
    let body;
    try {
      body = await res.json();
    } catch {
      body = undefined;
    }
    return { status: res.status, body, headers: res.headers };
  } catch (error) {
    return { status: 0, error: String(error.cause?.code ?? error.message) };
  }
}

const SANDBOX_KEY = path.join(REPO, "data", "sandbox", "id_ed25519");
const sandboxPort = () => Number(process.env.SANDBOX_LOCAL_PORT || 2222);

/** True when something accepts TCP on 127.0.0.1:<port> within 2 s. */
function tcpOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port, timeout: 2000 });
    socket.once("connect", () => (socket.destroy(), resolve(true)));
    socket.once("error", () => resolve(false));
    socket.once("timeout", () => (socket.destroy(), resolve(false)));
  });
}

const SANDBOX_CONTAINER = "tiny-agents-sandbox-sandbox-1";

/** A Shelley binary: env override, PATH, or copied out of the sandbox container. */
function shelleyBinary(stateDir) {
  if (process.env.TA_VERIFY_SHELLEY_BIN) return process.env.TA_VERIFY_SHELLEY_BIN;
  try {
    return execFileSync("which", ["shelley"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {}
  const copy = path.join(stateDir, "shelley");
  try {
    execFileSync("docker", ["cp", `${SANDBOX_CONTAINER}:/usr/local/bin/shelley`, copy], {
      stdio: "ignore",
    });
    return copy;
  } catch {
    fail(
      "--shelley: no binary (set TA_VERIFY_SHELLEY_BIN, put shelley on PATH, or `pnpm sandbox:up`)",
    );
  }
}

/** Start a predictable-only Shelley in its own process group, own DB and HOME. */
async function startShelley(run) {
  const bin = shelleyBinary(run.stateDir);
  const home = path.join(run.stateDir, "shelley-home");
  mkdirSync(home, { recursive: true });
  if ((listeners(run.shelleyPort) ?? []).length) fail(`--shelley: port ${run.shelleyPort} is busy`);
  const out = openSync(path.join(run.stateDir, "shelley.log"), "a");
  const child = spawn(
    bin,
    [
      "-predictable-only",
      "-db",
      path.join(run.stateDir, "shelley.db"),
      "serve",
      "-port",
      String(run.shelleyPort),
    ],
    // Its own HOME: Shelley puts a unix socket under ~/.config/shelley.
    {
      cwd: run.stateDir,
      env: { ...baseEnv(), HOME: home },
      detached: true,
      stdio: ["ignore", out, out],
    },
  );
  child.unref();
  run.shelleyPid = child.pid;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const models = await getJson(`${run.shelleyUrl}/api/models`);
    if (models.status === 200)
      return log(`shelley (predictable) on ${run.shelleyUrl}, pid ${child.pid}`);
    if (!alive(child.pid)) break;
    await sleep(500);
  }
  fail(`--shelley: did not answer; see ${path.join(run.stateDir, "shelley.log")}`);
}

async function stopGroup(pgid, label) {
  if (!pgid || !alive(pgid)) return;
  log(`stopping ${label} process group ${pgid}`);
  try {
    process.kill(-pgid, "SIGTERM");
  } catch {}
  const deadline = Date.now() + 15_000;
  while (alive(pgid) && Date.now() < deadline) await sleep(250);
  if (alive(pgid)) {
    log(`${label} still alive after 15s; SIGKILL`);
    try {
      process.kill(-pgid, "SIGKILL");
    } catch {}
  }
}

function sandboxEnv(run) {
  if (!run.sandbox) return { SANDBOX_HOST: "" };
  return {
    SANDBOX_HOST: "127.0.0.1",
    SANDBOX_PORT: String(run.sandboxPort),
    SANDBOX_USER: "exedev",
    SANDBOX_SSH_KEY_FILE: SANDBOX_KEY,
  };
}

/**
 * The base environment for processes a run starts: an allowlist of harmless
 * variables, never the caller's whole environment. Every key in the repo's
 * `.env` and every known external-service credential is set to "" on top, so
 * neither the shell nor `.env` (which the server and seed load, without
 * overriding variables that already exist) can hand a verification run real
 * keys: no real push notifications, model calls or error reports.
 */
const SAFE_VARS =
  /^(PATH|HOME|USER|LOGNAME|SHELL|LANG|LC_\w+|TZ|TMPDIR|TERM|NODE_EXTRA_CA_CERTS|SSL_CERT_FILE)$/;
const EXTERNAL_KEYS = [
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
  "DATABASE_URL",
  "AGENT_DB_PATH",
  "UPLOADS_DIR",
];

function baseEnv() {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => SAFE_VARS.test(key)),
  );
  for (const key of EXTERNAL_KEYS) env[key] = "";
  const dotenv = path.join(REPO, ".env");
  if (existsSync(dotenv)) {
    for (const line of readFileSync(dotenv, "utf8").split("\n")) {
      const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
      if (match) env[match[1]] = "";
    }
  }
  return env;
}

function serverEnv(run) {
  return {
    ...baseEnv(),
    NODE_ENV: "development",
    PORT: String(run.port),
    ORIGIN: run.url,
    RP_ID: "localhost",
    DATABASE_URL: `file:${run.stateDir}/app.db`,
    AGENT_DB_PATH: path.join(run.stateDir, "agent.db"),
    UPLOADS_DIR: path.join(run.stateDir, "uploads"),
    TINY_AGENTS_FAUX: "1",
    TINY_AGENTS_FAUX_TOKENS_PER_SECOND: "6",
    // Per-run key for vault items and connection secrets (scaffolding, dies with the run).
    SECRETS_KEY: run.secretsKey,
    // Per-run admin key for X-Admin-Auth-Key routes (e.g. creating a second user).
    ADMIN_AUTH_KEY: run.adminKey,
    // Without --sandbox: no sandbox, so terminal/computer/browser are unreachable.
    ...sandboxEnv(run),
    ...(run.shelleyUrl ? { SHELLEY_URL: run.shelleyUrl } : {}),
    PORTLESS: "0",
    NODE_OPTIONS: "--max-old-space-size=1024",
  };
}

async function up() {
  const port = Number(flags.port ?? process.env.TA_VERIFY_PORT ?? 3100);
  const id =
    flags.run ??
    new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");
  const stateDir = path.join(RUNS, id);
  if (existsSync(path.join(stateDir, "run.json")))
    fail(`run ${id} already exists; pick another --run or \`down\` it`);

  // The dev server also opens Vite's HMR socket on port + 1: both must be free,
  // so space concurrent runs at least 2 apart (10 apart is easy to read).
  const busy = [...(listeners(port) ?? []), ...(listeners(port + 1) ?? [])];
  const probe = await getJson(`http://localhost:${port}/health`);
  if (busy.length || probe.status) {
    fail(
      `port ${port} or ${port + 1} (HMR) is already in use (pids: ${busy.join(",") || "?"}). Not ours: pick --port, never drive it.`,
    );
  }

  if (flags.sandbox) {
    if (!existsSync(SANDBOX_KEY))
      fail(`no sandbox key at ${SANDBOX_KEY}: run \`pnpm sandbox:up\` first`);
    if (!(await tcpOpen(sandboxPort())))
      fail(
        `local sandbox SSH is not answering on 127.0.0.1:${sandboxPort()}: run \`pnpm sandbox:up\``,
      );
    // The sandbox is one shared machine (tmux tabs, browser profiles): one run at a time.
    for (const other of existsSync(RUNS) ? readdirSync(RUNS) : []) {
      const file = path.join(RUNS, other, "run.json");
      if (!existsSync(file)) continue;
      const r = JSON.parse(readFileSync(file, "utf8"));
      if (r.sandbox && alive(r.pid))
        fail(`run ${other} already drives the sandbox; \`down\` it first`);
    }
  }
  mkdirSync(path.join(stateDir, "uploads"), { recursive: true });
  const evidenceDir = path.join(EVIDENCE, id);
  mkdirSync(evidenceDir, { recursive: true });
  const run = {
    id,
    port,
    url: `http://localhost:${port}`,
    stateDir,
    evidenceDir,
    revision: head(),
    startedAt: new Date().toISOString(),
    sandbox: !!flags.sandbox,
    sandboxPort: flags.sandbox ? sandboxPort() : undefined,
    empty: !!flags.empty,
    shelleyPort: flags.shelley ? port + 1000 : undefined,
    shelleyUrl: flags.shelley ? `http://127.0.0.1:${port + 1000}` : undefined,
    secretsKey: randomBytes(32).toString("base64"),
    adminKey: randomBytes(24).toString("hex"),
  };
  const env = serverEnv(run);
  const tsx = path.join(REPO, "node_modules", ".bin", "tsx");
  if (!existsSync(tsx)) fail("node_modules missing: run `pnpm install` first");

  if (run.empty) log("--empty: no seed; the server applies migrations on boot");
  else {
    log(`seeding ${env.DATABASE_URL} (migrations + demo user)`);
    execFileSync(tsx, ["scripts/seed.ts"], { cwd: REPO, env, stdio: "inherit" });
  }

  if (flags.shelley) {
    writeFileSync(path.join(stateDir, "run.json"), JSON.stringify(run, null, 2));
    await startShelley(run);
  }
  const logFile = path.join(stateDir, "server.log");
  const out = openSync(logFile, "a");
  // detached = own process group, so `down` kills exactly this tree.
  const child = spawn(tsx, ["apps/web/src/server/entry.node.ts"], {
    cwd: REPO,
    env,
    detached: true,
    stdio: ["ignore", out, out],
  });
  child.unref();
  run.pid = child.pid;
  run.pgid = child.pid;
  writeFileSync(path.join(stateDir, "run.json"), JSON.stringify(run, null, 2));
  writeFileSync(CURRENT, id);
  log(`started pid ${child.pid}, log ${path.relative(REPO, logFile)}`);

  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    if (!alive(child.pid)) fail(`server exited during boot; see ${logFile}`);
    const ready = await getJson(`${run.url}/ready`);
    if (ready.status === 200 && ready.body?.ready) break;
    await sleep(1000);
  }
  if (Date.now() >= deadline) fail(`not ready after 240s; see ${logFile}`);
  // Ready means usable: the SPA is served and the demo user can sign in.
  const ok = await doctor(run, { quiet: true });
  if (!ok) fail("instance answered /ready but doctor failed; run `ta-verify doctor` for details");
  log(`READY run=${id} url=${run.url} evidence=${path.relative(REPO, evidenceDir)}`);
}

async function doctor(run = readRun(runId()), { quiet = false } = {}) {
  const checks = [];
  const check = (name, pass, detail = "") => checks.push({ name, pass, detail });

  check("process alive", alive(run.pid), `pid ${run.pid}`);
  const owners = listeners(run.port);
  if (owners === null) check("port owned by this run", true, "lsof missing; skipped (WARN)");
  else {
    const ours = owners.length > 0 && owners.every((p) => p === run.pid || pgidOf(p) === run.pgid);
    check(
      "port owned by this run",
      ours,
      `port ${run.port} listeners: ${owners.join(",") || "none"}`,
    );
  }
  const health = await getJson(`${run.url}/health`);
  check(
    "/health ok",
    health.status === 200 && health.body?.status === "ok",
    `${health.status} ${health.error ?? ""}`,
  );
  const ready = await getJson(`${run.url}/ready`);
  check("/ready ok", ready.status === 200, JSON.stringify(ready.body ?? ready.error));
  // No watcher: the instance runs the code it booted with. Only app sources count;
  // commits or edits that touch nothing but docs or this skill don't make it stale.
  const stale = appChangesSince(run.revision);
  check(
    "app code unchanged since launch",
    stale.length === 0,
    stale.length
      ? `changed since ${run.revision}: ${stale.slice(0, 5).join(", ")}${stale.length > 5 ? ", …" : ""} (relaunch)`
      : `launched at ${run.revision}, HEAD ${head()}`,
  );
  const spa = await fetch(`${run.url}/login`)
    .then((r) => r.text())
    .catch(() => "");
  check(
    "SPA served",
    spa.includes('id="root"') || spa.includes("<script"),
    "GET /login returns the client shell",
  );
  if (run.shelleyUrl) {
    const models = await getJson(`${run.shelleyUrl}/api/models`);
    const predictable = (models.body ?? []).some?.((m) => m.id === "predictable");
    check(
      "shelley (predictable) answers",
      models.status === 200 && !!predictable,
      `${run.shelleyUrl}/api/models -> ${models.status}`,
    );
  }
  if (run.sandbox) {
    check("sandbox SSH answers", await tcpOpen(run.sandboxPort), `127.0.0.1:${run.sandboxPort}`);
  }
  if (run.empty) {
    // No demo user by design; once /setup has created the first account, needsSetup is false.
    const setup = await getJson(`${run.url}/api/v1/auth/setup`);
    check(
      "setup endpoint",
      setup.status === 200,
      `GET /api/v1/auth/setup -> ${setup.status} ${JSON.stringify(setup.body?.data)}`,
    );
    return report(run, checks, quiet);
  }
  const login = await getJson(`${run.url}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(DEMO),
  });
  check(
    "demo login",
    login.status === 200,
    `POST /api/v1/auth/login -> ${login.status}${login.status === 429 ? " (auth rate limit: 20 / 15 min)" : ""}`,
  );
  const cookie = login.headers?.get("set-cookie")?.split(";")[0];
  const token = login.body?.data?.token;
  const auth = token ? { authorization: `Bearer ${token}` } : cookie ? { cookie } : {};
  // A verification run must never reach real devices (see baseEnv()).
  const push = await getJson(`${run.url}/api/v1/notifications/status`, { headers: auth });
  check(
    "push notifications off",
    push.status === 200 && push.body?.data?.state === "not_configured",
    `GET /api/v1/notifications/status -> ${push.status} ${JSON.stringify(push.body?.data)}`,
  );
  const models = await getJson(`${run.url}/api/v1/models`, { headers: auth });
  const faux = (models.body?.data?.models ?? []).some((m) => /faux/i.test(`${m.id} ${m.name}`));
  check(
    "faux model catalog",
    models.status === 200 && faux,
    `GET /api/v1/models -> ${models.status}, faux=${faux}`,
  );

  return report(run, checks, quiet);
}

function report(run, checks, quiet) {
  const okAll = checks.every((c) => c.pass);
  if (!quiet || !okAll) {
    for (const c of checks)
      console.log(`  ${c.pass ? "ok  " : "FAIL"} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
    log(`doctor ${okAll ? "OK" : "FAILED"} run=${run.id} url=${run.url}`);
  }
  return okAll;
}

async function drive() {
  if (!positional.length) fail("usage: ta-verify drive <journey.mjs>... [--run <id>]");
  const run = readRun(runId());
  let failed = 0;
  const unreachable = [];
  for (const journey of positional) {
    const file = path.resolve(journey);
    if (!existsSync(file)) fail(`no journey at ${file}`);
    log(`drive ${path.relative(REPO, file)}`);
    const code = await new Promise((resolve) => {
      const child = spawn(process.execPath, [file], {
        cwd: REPO,
        stdio: "inherit",
        env: {
          ...process.env,
          TA_VERIFY_URL: run.url,
          TA_VERIFY_EVIDENCE: run.evidenceDir,
          TA_VERIFY_RUN: run.id,
          TA_VERIFY_ADMIN_KEY: run.adminKey,
          TA_VERIFY_CAPS: [
            run.sandbox && "sandbox",
            run.empty && "empty",
            run.shelleyUrl && "shelley",
          ]
            .filter(Boolean)
            .join(","),
        },
      });
      child.on("exit", (c) => resolve(c ?? 1));
    });
    // Exit 3 = the journey needs a launch option this run lacks (see journey `requires`).
    if (code === 3) unreachable.push(path.basename(file));
    else if (code !== 0) failed++;
  }
  const passed = positional.length - failed - unreachable.length;
  log(
    `${passed}/${positional.length} journeys passed, ${failed} failed, ${unreachable.length} unreachable${unreachable.length ? ` (${unreachable.join(", ")})` : ""}; evidence ${path.relative(REPO, run.evidenceDir)}`,
  );
  if (failed || unreachable.length) process.exit(1);
}

async function down() {
  const id = runId();
  const run = readRun(id);
  await stopGroup(alive(run.pid) ? run.pgid : undefined, "server");
  await stopGroup(run.shelleyPid, "shelley");
  for (const name of ["shelley.log"]) {
    const file = path.join(run.stateDir, name);
    if (existsSync(file)) writeFileSync(path.join(run.evidenceDir, name), readFileSync(file));
  }
  const leftovers = listeners(run.port);
  if (leftovers?.length)
    log(
      `WARN port ${run.port} still has listeners: ${leftovers.join(",")} (not killed: not provably ours)`,
    );
  // Keep the server log with the evidence, then drop the state.
  const logFile = path.join(run.stateDir, "server.log");
  if (existsSync(logFile))
    writeFileSync(path.join(run.evidenceDir, "server.log"), readFileSync(logFile));
  rmSync(run.stateDir, { recursive: true, force: true });
  if (existsSync(CURRENT) && readFileSync(CURRENT, "utf8").trim() === id) rmSync(CURRENT);
  const kept = existsSync(run.evidenceDir)
    ? readdirSync(run.evidenceDir, { recursive: true }).length
    : 0;
  if (!kept) fail(`evidence dir ${run.evidenceDir} is empty or gone after cleanup`);
  log(`down run=${id}; evidence kept: ${path.relative(REPO, run.evidenceDir)} (${kept} entries)`);
}

function status() {
  if (!existsSync(RUNS)) return log("no runs");
  const current = existsSync(CURRENT) ? readFileSync(CURRENT, "utf8").trim() : "";
  for (const id of readdirSync(RUNS)) {
    const file = path.join(RUNS, id, "run.json");
    if (!existsSync(file)) continue;
    const run = JSON.parse(readFileSync(file, "utf8"));
    console.log(
      `${id === current ? "*" : " "} ${id} ${run.url} pid=${run.pid} ${alive(run.pid) ? "alive" : "dead"} rev=${run.revision}${run.sandbox ? " sandbox" : ""}${run.empty ? " empty" : ""}`,
    );
  }
}

const commands = {
  up,
  doctor: async () => process.exit((await doctor()) ? 0 : 1),
  drive,
  down,
  status,
};
if (!commands[command]) {
  console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0]);
  process.exit(command ? 1 : 0);
}
await commands[command]();
