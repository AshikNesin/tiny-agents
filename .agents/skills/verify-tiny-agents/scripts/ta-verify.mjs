#!/usr/bin/env node
/**
 * ta-verify: launch, health-check, drive and tear down one isolated
 * tiny-agents instance for verification.
 *
 *   ta-verify up [--port 3100] [--run <id>]   start a fresh instance (own DBs, faux model)
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
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith("--")) flags[rest[i].slice(2)] = rest[++i];
  else positional.push(rest[i]);
}

const log = (msg) => console.log(`[ta-verify] ${msg}`);
const fail = (msg) => {
  console.error(`[ta-verify] FAIL: ${msg}`);
  process.exit(1);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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

function serverEnv(run) {
  return {
    ...process.env,
    NODE_ENV: "development",
    PORT: String(run.port),
    ORIGIN: run.url,
    RP_ID: "localhost",
    DATABASE_URL: `file:${run.stateDir}/app.db`,
    AGENT_DB_PATH: path.join(run.stateDir, "agent.db"),
    UPLOADS_DIR: path.join(run.stateDir, "uploads"),
    TINY_AGENTS_FAUX: "1",
    TINY_AGENTS_FAUX_TOKENS_PER_SECOND: "6",
    // No sandbox VM: terminal/computer/browser pages are unreachable by design.
    SANDBOX_HOST: "",
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

  const busy = listeners(port);
  const probe = await getJson(`http://localhost:${port}/health`);
  if ((busy && busy.length) || probe.status) {
    fail(
      `port ${port} is already in use (pids: ${busy?.join(",") || "?"}). Not ours: pick --port, never drive it.`,
    );
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
  };
  const env = serverEnv(run);
  const tsx = path.join(REPO, "node_modules", ".bin", "tsx");
  if (!existsSync(tsx)) fail("node_modules missing: run `pnpm install` first");

  log(`seeding ${env.DATABASE_URL} (migrations + demo user)`);
  execFileSync(tsx, ["scripts/seed.ts"], { cwd: REPO, env, stdio: "inherit" });

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
  const current = head();
  check(
    "revision matches launch",
    current === run.revision,
    `launched ${run.revision}, HEAD ${current} (no watch: relaunch after code changes)`,
  );
  const spa = await fetch(`${run.url}/login`)
    .then((r) => r.text())
    .catch(() => "");
  check(
    "SPA served",
    spa.includes('id="root"') || spa.includes("<script"),
    "GET /login returns the client shell",
  );
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
  const models = await getJson(`${run.url}/api/v1/models`, { headers: auth });
  const faux = (models.body?.data?.models ?? []).some((m) => /faux/i.test(`${m.id} ${m.name}`));
  check(
    "faux model catalog",
    models.status === 200 && faux,
    `GET /api/v1/models -> ${models.status}, faux=${faux}`,
  );

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
        },
      });
      child.on("exit", (c) => resolve(c ?? 1));
    });
    if (code !== 0) failed++;
  }
  log(
    `${positional.length - failed}/${positional.length} journeys passed; evidence ${path.relative(REPO, run.evidenceDir)}`,
  );
  if (failed) process.exit(1);
}

async function down() {
  const id = runId();
  const run = readRun(id);
  if (alive(run.pid)) {
    log(`stopping process group ${run.pgid}`);
    try {
      process.kill(-run.pgid, "SIGTERM");
    } catch {}
    const deadline = Date.now() + 15_000;
    while (alive(run.pid) && Date.now() < deadline) await sleep(250);
    if (alive(run.pid)) {
      log("still alive after 15s; SIGKILL");
      try {
        process.kill(-run.pgid, "SIGKILL");
      } catch {}
    }
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
      `${id === current ? "*" : " "} ${id} ${run.url} pid=${run.pid} ${alive(run.pid) ? "alive" : "dead"} rev=${run.revision}`,
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
