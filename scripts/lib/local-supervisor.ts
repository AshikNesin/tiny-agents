/**
 * The state machine behind `pnpm local` (scripts/local.ts,
 * docs/guides/local-updates.md): run one built release of the server as a
 * child, check the tracked ref for new commits, build them beside the
 * running release, swap them in, and roll back when the new one does not
 * come up. Git, the build and the child process come in as ports, so the
 * flow is tested without them (tests/server/scripts/local-supervisor.test.ts).
 */
import type {
  ServerMessage,
  UpdateCommit,
  UpdatePhase,
  UpdateRelease,
  UpdateStatus,
} from "../../apps/web/src/shared/local-updates";
import { isServerMessage } from "../../apps/web/src/shared/local-updates";

/** A running server process. */
export interface ServerHandle {
  send(message: unknown): void;
  onMessage(listener: (message: unknown) => void): void;
  /** Fires once, when the process exits for any reason. */
  onExit(listener: (code: number | null) => void): void;
  /** SIGTERM, then SIGKILL after a grace period; resolves when it has exited. */
  stop(): Promise<void>;
}

export interface CheckResult {
  latest: UpdateRelease;
  commits: UpdateCommit[];
  sandboxChanged: boolean;
}

export interface SupervisorPorts {
  /** Fetch the tracked ref and compare it with `current`. */
  check(current: string): Promise<CheckResult>;
  releaseInfo(sha: string): Promise<UpdateRelease>;
  isBuilt(sha: string): boolean;
  /** Check out and build `sha` beside the running release. */
  build(sha: string, onLine: (line: string) => void): Promise<void>;
  launch(sha: string): ServerHandle;
  /** True once the server answers its readiness probe; releases from before the IPC message rely on it. */
  probe(): Promise<boolean>;
  saveCurrent(sha: string): void;
  /** Delete built releases other than `keep`. */
  prune(keep: string[]): Promise<void>;
  log(line: string): void;
}

export interface SupervisorOptions {
  track: string;
  auto: boolean;
  /** How long a new server may take to say it is ready. */
  readyTimeoutMs: number;
  /** How often to call `probe` while waiting. */
  probeIntervalMs: number;
  /** Delay before restarting a server that crashed, doubled per crash up to 30 s. */
  crashBackoffMs: number;
}

const LOG_LINES = 30;
const MAX_BACKOFF_MS = 30_000;
/** A server up this long resets the crash backoff. */
const HEALTHY_MS = 60_000;

export class Supervisor {
  private server: ServerHandle | undefined;
  private running!: UpdateRelease;
  private latest: UpdateRelease | null = null;
  private commits: UpdateCommit[] = [];
  private sandboxChanged = false;
  private phase: UpdatePhase = "idle";
  private error: string | null = null;
  private logLines: string[] = [];
  private lastCheckedAt: number | null = null;
  private stopping = false;
  /** Set while this supervisor stops the server on purpose. */
  private swapping = false;
  private backoff: number;
  private restartTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly ports: SupervisorPorts,
    private readonly options: SupervisorOptions,
  ) {
    this.backoff = options.crashBackoffMs;
  }

  status(): UpdateStatus {
    return {
      track: this.options.track,
      current: this.running,
      latest: this.latest,
      commits: this.commits,
      sandboxChanged: this.sandboxChanged,
      phase: this.phase,
      error: this.error,
      log: this.logLines,
      auto: this.options.auto,
      lastCheckedAt: this.lastCheckedAt,
    };
  }

  /** Run `sha`, building it first if needed. Rejects when it never comes up. */
  async start(sha: string): Promise<void> {
    if (!this.ports.isBuilt(sha)) {
      this.ports.log(`Building ${sha.slice(0, 7)} for the first run`);
      await this.ports.build(sha, (line) => this.ports.log(line));
    }
    this.running = await this.ports.releaseInfo(sha);
    const up = await this.launch(sha);
    if (!up) throw new Error(`Release ${sha.slice(0, 7)} did not start`);
    this.ports.saveCurrent(sha);
  }

  /** Fetch the tracked ref; with `auto`, update straight away when it moved. */
  async check(): Promise<void> {
    if (this.phase === "checking" || this.phase === "building" || this.phase === "restarting") {
      return;
    }
    this.setPhase("checking");
    try {
      const result = await this.ports.check(this.running.sha);
      this.latest = result.latest;
      this.commits = result.commits;
      this.sandboxChanged = result.sandboxChanged;
      this.lastCheckedAt = Date.now();
      this.error = null;
      this.setPhase("idle");
    } catch (error) {
      this.fail(`Check failed: ${messageOf(error)}`);
      return;
    }
    if (this.options.auto && this.updateAvailable()) await this.apply();
  }

  updateAvailable(): boolean {
    return this.latest !== null && this.latest.sha !== this.running.sha;
  }

  /** Build the latest commit and restart onto it; the running server keeps serving until then. */
  async apply(): Promise<void> {
    if (this.phase === "building" || this.phase === "restarting" || this.stopping) return;
    if (!this.latest) await this.check();
    const target = this.latest;
    if (!target || target.sha === this.running.sha) return;

    this.logLines = [];
    this.error = null;
    this.setPhase("building");
    try {
      if (!this.ports.isBuilt(target.sha)) {
        await this.ports.build(target.sha, (line) => this.addLog(line));
      }
    } catch (error) {
      this.fail(`Build of ${target.sha.slice(0, 7)} failed: ${messageOf(error)}`);
      return;
    }
    if (this.stopping) return;

    this.setPhase("restarting");
    const from = this.running;
    await this.stopServer();
    this.running = target;
    if (await this.launch(target.sha)) {
      this.ports.saveCurrent(target.sha);
      this.commits = [];
      this.sandboxChanged = false;
      this.ports.log(`Updated ${from.sha.slice(0, 7)} → ${target.sha.slice(0, 7)}`);
      this.setPhase("idle");
      await this.ports.prune([target.sha, from.sha]).catch((error: unknown) => {
        this.ports.log(`Could not delete old releases: ${messageOf(error)}`);
      });
      return;
    }

    // The new release never said it was ready: go back to the one that worked.
    this.ports.log(`Release ${target.sha.slice(0, 7)} did not start; rolling back`);
    await this.stopServer();
    this.running = from;
    if (!(await this.launch(from.sha))) this.scheduleRestart(null);
    this.fail(
      `Release ${target.sha.slice(0, 7)} did not start, so ${from.sha.slice(0, 7)} is running again. See the terminal running pnpm local.`,
    );
  }

  /** Stop the server and every timer; the supervisor then exits. */
  async shutdown(): Promise<void> {
    this.stopping = true;
    clearTimeout(this.restartTimer);
    await this.stopServer();
  }

  private async launch(sha: string): Promise<boolean> {
    const server = this.ports.launch(sha);
    this.server = server;
    const startedAt = Date.now();
    let exited = false;
    let up = false;

    const ready = new Promise<boolean>((resolve) => {
      let settled = false;
      const done = (up: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearInterval(poll);
        resolve(up);
      };
      const timer = setTimeout(() => done(false), this.options.readyTimeoutMs);
      const poll = setInterval(() => {
        void this.ports.probe().then((up) => {
          if (up && !exited) done(true);
        });
      }, this.options.probeIntervalMs);
      server.onMessage((message) => {
        if (!isServerMessage(message)) return;
        this.handle(message);
        if (message.type === "server-ready") done(true);
      });
      server.onExit((code) => {
        exited = true;
        done(false);
        this.onServerExit(server, code, startedAt, up);
      });
    });

    up = await ready;
    if (up) this.broadcast();
    else if (!exited) await server.stop();
    return up;
  }

  private handle(message: ServerMessage): void {
    if (message.type === "update-check") void this.check();
    if (message.type === "update-apply") void this.apply();
  }

  /**
   * A server exited. One that had come up and was not stopped on purpose
   * crashed: start the release again. One that never came up is its
   * launcher's to handle (rollback, or the next restart attempt).
   */
  private onServerExit(
    server: ServerHandle,
    code: number | null,
    startedAt: number,
    wasUp: boolean,
  ): void {
    if (this.server !== server) return;
    this.server = undefined;
    if (this.stopping || this.swapping || !wasUp) return;
    if (Date.now() - startedAt > HEALTHY_MS) this.backoff = this.options.crashBackoffMs;
    this.scheduleRestart(code);
  }

  /** Start the running release again after the backoff, and again until it comes up. */
  private scheduleRestart(code: number | null): void {
    clearTimeout(this.restartTimer);
    const delay = this.backoff;
    this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
    this.ports.log(`Server exited (code ${code ?? "signal"}); restarting in ${delay / 1000}s`);
    this.restartTimer = setTimeout(() => {
      if (this.stopping || this.server) return;
      void this.launch(this.running.sha).then((up) => {
        if (!up && !this.stopping && !this.server) this.scheduleRestart(null);
      });
    }, delay);
  }

  private async stopServer(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.swapping = true;
    try {
      await server.stop();
    } finally {
      this.swapping = false;
      if (this.server === server) this.server = undefined;
    }
  }

  private addLog(line: string): void {
    this.ports.log(line);
    this.logLines = [...this.logLines, line].slice(-LOG_LINES);
    this.broadcast();
  }

  private fail(message: string): void {
    this.error = message;
    this.ports.log(message);
    this.setPhase("failed");
  }

  private setPhase(phase: UpdatePhase): void {
    this.phase = phase;
    this.broadcast();
  }

  private broadcast(): void {
    if (!this.running) return;
    this.server?.send({ type: "update-status", status: this.status() });
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
