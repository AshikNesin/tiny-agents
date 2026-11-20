/**
 * The bundled 1Password Connect server (ADR 0027): with
 * `OP_CONNECT_CREDENTIALS` set and no `OP_CONNECT_HOST`, the app runs
 * Connect's two processes itself, inside its own container, instead of a
 * separate service. `connect-api` answers the vault backend on loopback and
 * `connect-sync` keeps the local copy of the vault current; they find each
 * other over Connect's bus on fixed loopback ports, the layout 1Password
 * documents for running both where broadcast discovery isn't available.
 *
 * Their state (the encrypted vault cache) lives next to the agent store on
 * the data volume, so a redeploy starts from it. A process that exits is
 * started again with backoff; stopping the app stops both.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { logger } from "@groot/core/logger";
import { app } from "../../../app-root";
import { agentDbPath, appEnv } from "../../../env";
import {
  CONNECT_VERSION,
  ensureConnectBinary,
  pruneOtherVersions,
  type ConnectBinary,
} from "./connect-image";

/** Loopback ports: the API the backend calls, sync's own HTTP port, and the two bus ports. */
const BUNDLED_PORTS = { api: 11280, sync: 11281, apiBus: 11282, syncBus: 11283 };

export const BUNDLED_CONNECT_HOST = `http://127.0.0.1:${BUNDLED_PORTS.api}`;

type BundledState =
  | { state: "starting"; detail: string }
  | { state: "running"; detail: string }
  | { state: "failed"; detail: string };

export interface BundledConnect {
  state(): BundledState;
  stop(): Promise<void>;
}

const unquote = (value: string | undefined) =>
  value
    ?.trim()
    .replace(/^(['"])([\s\S]*)\1$/, "$2")
    .trim() || undefined;

/**
 * `1password-credentials.json` from `OP_CONNECT_CREDENTIALS`, as the base64
 * Connect's `OP_SESSION` takes. The variable holds the file's JSON or its
 * base64; anything else is refused with a reason.
 */
export function sessionFromCredentials(raw: string): string {
  const value = unquote(raw) ?? "";
  const json = value.startsWith("{") ? value : Buffer.from(value, "base64").toString("utf8");
  try {
    const parsed = JSON.parse(json) as unknown;
    if (parsed && typeof parsed === "object" && "deviceUuid" in parsed) {
      return Buffer.from(json, "utf8").toString("base64");
    }
  } catch {
    // Reported below.
  }
  throw new Error(
    "OP_CONNECT_CREDENTIALS must hold the 1password-credentials.json file, as JSON or base64.",
  );
}

/** True when the app should run Connect itself: credentials given and no external host. */
export function bundledConnectWanted(): boolean {
  const env = appEnv();
  return Boolean(unquote(env.OP_CONNECT_CREDENTIALS)) && !unquote(env.OP_CONNECT_HOST);
}

/** Where the bundled server keeps its binaries and vault cache: beside the agent store. */
function bundledConnectDir(): string {
  return path.join(path.dirname(path.resolve(agentDbPath())), "op-connect");
}

export interface StartOptions {
  /** Base64 `OP_SESSION`. */
  session: string;
  dir: string;
  /** Resolves each binary's path (pulls it on first use). */
  binary?: (name: ConnectBinary) => Promise<string>;
  ports?: typeof BUNDLED_PORTS;
  /** First restart delay; doubles per crash up to a minute. */
  restartDelayMs?: number;
  platform?: NodeJS.Platform;
}

const MAX_RESTART_DELAY_MS = 60_000;
/** A process that ran this long is healthy again: its next crash restarts at the first delay. */
const HEALTHY_AFTER_MS = 60_000;

export function startBundledConnect(options: StartOptions): BundledConnect {
  const ports = options.ports ?? BUNDLED_PORTS;
  const firstDelay = options.restartDelayMs ?? 1_000;
  const resolveBinary =
    options.binary ?? ((name: ConnectBinary) => ensureConnectBinary(name, { dir: options.dir }));
  const home = path.join(options.dir, "home");
  let current: BundledState = {
    state: "starting",
    detail: `Starting the bundled Connect server (${CONNECT_VERSION}).`,
  };
  let stopping = false;
  const children = new Map<ConnectBinary, ChildProcess>();
  const timers = new Set<NodeJS.Timeout>();

  const envFor = (name: ConnectBinary): NodeJS.ProcessEnv => {
    const api = name === "connect-api";
    return {
      PATH: "/usr/local/bin:/usr/bin:/bin",
      HOME: home,
      OP_SESSION: options.session,
      OP_HTTP_PORT: String(api ? ports.api : ports.sync),
      OP_BUS_PORT: String(api ? ports.apiBus : ports.syncBus),
      OP_BUS_PEERS: `localhost:${api ? ports.syncBus : ports.apiBus}`,
      OP_LOG_LEVEL: "info",
    };
  };

  function run(name: ConnectBinary, file: string, delay: number): void {
    if (stopping) return;
    const startedAt = Date.now();
    const child = spawn(file, [], { env: envFor(name), stdio: ["ignore", "pipe", "pipe"] });
    children.set(name, child);
    const recent: string[] = [];
    const onOutput = (chunk: Buffer) => {
      for (const line of chunk.toString("utf8").split("\n")) {
        if (!line.trim()) continue;
        recent.push(line);
        if (recent.length > 20) recent.shift();
        logger.debug({ connect: name }, line);
      }
    };
    child.stdout?.on("data", onOutput);
    child.stderr?.on("data", onOutput);
    child.on("spawn", () => {
      if (children.size === 2 && [...children.values()].every((c) => c.pid)) {
        current = { state: "running", detail: `Bundled Connect server ${CONNECT_VERSION}.` };
      }
    });
    child.on("error", (error) => {
      logger.warn({ connect: name, error: error.message }, "The bundled Connect server failed");
    });
    child.on("exit", (code, signal) => {
      if (children.get(name) === child) children.delete(name);
      if (stopping) return;
      const wait = Date.now() - startedAt >= HEALTHY_AFTER_MS ? firstDelay : delay;
      logger.warn(
        { connect: name, code, signal, output: recent.slice(-5) },
        `The bundled Connect server's ${name} exited; restarting in ${Math.round(wait / 1000)} s`,
      );
      current = {
        state: "starting",
        detail: `Restarting ${name} (it exited with ${code ?? signal}).`,
      };
      const timer = setTimeout(() => {
        timers.delete(timer);
        run(name, file, Math.min(wait * 2, MAX_RESTART_DELAY_MS));
      }, wait);
      timer.unref();
      timers.add(timer);
    });
  }

  void (async () => {
    try {
      if ((options.platform ?? process.platform) !== "linux") {
        throw new Error(
          "The bundled Connect server runs on Linux only; set OP_CONNECT_HOST to a Connect server instead.",
        );
      }
      await mkdir(home, { recursive: true, mode: 0o700 });
      current = {
        state: "starting",
        detail: `Fetching 1Password Connect ${CONNECT_VERSION} (first start only).`,
      };
      const api = await resolveBinary("connect-api");
      const sync = await resolveBinary("connect-sync");
      if (!options.binary) await pruneOtherVersions(options.dir);
      if (stopping) return;
      current = { state: "starting", detail: `Starting the bundled Connect server.` };
      run("connect-sync", sync, firstDelay);
      run("connect-api", api, firstDelay);
    } catch (error) {
      current = { state: "failed", detail: (error as Error).message };
      logger.error({ error: (error as Error).message }, "The bundled Connect server can't start");
    }
  })();

  return {
    state: () => current,
    async stop() {
      stopping = true;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      await Promise.all(
        [...children.values()].map(
          (child) =>
            new Promise<void>((resolve) => {
              if (child.exitCode !== null || child.signalCode !== null) return resolve();
              const kill = setTimeout(() => child.kill("SIGKILL"), 3_000);
              kill.unref();
              child.once("exit", () => {
                clearTimeout(kill);
                resolve();
              });
              child.kill("SIGTERM");
            }),
        ),
      );
      children.clear();
    },
  };
}

/**
 * Boot: start the bundled server when the env asks for one. Never fails boot;
 * a bad credentials file shows on the Vault page and in the log.
 */
export function startBundledConnectFromEnv(): void {
  if (!bundledConnectWanted()) return;
  let session: string;
  try {
    session = sessionFromCredentials(appEnv().OP_CONNECT_CREDENTIALS ?? "");
  } catch (error) {
    const detail = (error as Error).message;
    logger.error({}, detail);
    app().bundledConnect = { state: () => ({ state: "failed", detail }), stop: async () => {} };
    return;
  }
  app().bundledConnect = startBundledConnect({ session, dir: bundledConnectDir() });
}

/** Shutdown: stop both Connect processes. */
export async function stopBundledConnect(): Promise<void> {
  const running = app().bundledConnect;
  app().bundledConnect = undefined;
  await running?.stop();
}
