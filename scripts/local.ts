#!/usr/bin/env tsx
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { parseArgs, parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import { Supervisor } from "./lib/local-supervisor";
import {
  compare,
  defaultReleasesDir,
  fetchTracked,
  git,
  releaseInfo,
  releaseStore,
  trackLabel,
  type Track,
} from "./lib/local-releases";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const { values } = parseArgs({
  options: {
    track: { type: "string", default: "main" },
    remote: { type: "string", default: "origin" },
    auto: { type: "boolean", default: false },
    "check-every": { type: "string", default: "60" },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (values.help) {
  console.log(`Usage: pnpm local [--track <branch>|release] [--remote <name>] [--auto] [--check-every <minutes>]
See docs/guides/local-updates.md.`);
  process.exit(0);
}

const track: Track =
  values.track === "release"
    ? { kind: "release", remote: values.remote }
    : { kind: "branch", remote: values.remote, branch: values.track };
const checkEveryMs = Number(values["check-every"]) * 60_000;
if (!Number.isFinite(checkEveryMs) || checkEveryMs < 0) {
  console.error("--check-every takes a number of minutes");
  process.exit(2);
}

function serverPort(): number {
  const envFile = path.join(root, ".env");
  const fromFile = existsSync(envFile) ? parseEnv(readFileSync(envFile, "utf8")).PORT : undefined;
  return Number(process.env.PORT || fromFile || 3000);
}
const port = serverPort();

const store = releaseStore(root, process.env.TINY_AGENTS_RELEASES_DIR || defaultReleasesDir());
const log = (line: string) => console.log(`[local] ${line}`);

async function serverReady(): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/ready`, {
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

const supervisor = new Supervisor(
  {
    check: async (current) => {
      const sha = await fetchTracked(root, track);
      return { latest: await releaseInfo(root, sha), ...(await compare(root, current, sha)) };
    },
    releaseInfo: (sha) => releaseInfo(root, sha),
    isBuilt: store.isBuilt,
    build: store.build,
    launch: store.launch,
    probe: serverReady,
    saveCurrent: store.saveCurrent,
    prune: store.prune,
    log,
  },
  {
    track: trackLabel(track),
    auto: values.auto,
    readyTimeoutMs: 5 * 60_000,
    probeIntervalMs: 2000,
    crashBackoffMs: 1000,
  },
);

async function firstRelease(): Promise<string> {
  const current = store.readCurrent();
  if (current) return current;
  try {
    return await fetchTracked(root, track);
  } catch (error) {
    log(`Could not fetch ${trackLabel(track)} (${String(error)}); using this checkout's HEAD`);
    return (await git(root, ["rev-parse", "HEAD"])).trim();
  }
}

let signals = 0;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    signals += 1;
    if (signals > 1) process.exit(130);
    log("Stopping the server…");
    void supervisor.shutdown().then(() => process.exit(0));
  });
}

const sha = await firstRelease();
log(`Starting ${sha.slice(0, 7)} (following ${trackLabel(track)})`);
try {
  await supervisor.start(sha);
} catch (error) {
  log(String(error));
  process.exit(1);
}
await store
  .prune([sha])
  .catch((error: unknown) => log(`Could not prune old releases (${String(error)})`));

const check = () => void supervisor.check();
setTimeout(check, 10_000);
setInterval(check, checkEveryMs > 0 ? checkEveryMs : 2 ** 30);
