/**
 * The ssh2 binding for the terminal transport (issue #28): runs tmux
 * commands on the sandbox VM over keyless Tailscale SSH (the same dial /
 * TOFU / none-auth posture as the sandbox toolkit) and opens tmux attaches
 * as pty channels.
 *
 * One pooled connection per transport (issue #84). A fresh handshake over
 * the tailnet costs about 2s, and the page paid it on every list, ticket and
 * attach, so exec and pty channels now share one lazily dialed client.
 * Concurrent first callers share the in-flight dial; a client that closes
 * or errors is dropped and the next call redials; the client ends after
 * `idleTimeoutMs` with no open channel.
 *
 * The tailnet stall browser-remote-cdp.ts works around follows direct-tcpip
 * channels. Exec and pty are session channels, which the sandbox toolkit has
 * multiplexed over one connection all along. As a backstop, a channel that
 * is refused or does not open in time retires the connection: new channels
 * go to a fresh one, and the retired one ends once its last attach closes.
 */
import { createHash } from "node:crypto";
import { Duplex } from "node:stream";
import ssh2, { type ClientChannel, type ConnectConfig, type ExecOptions } from "ssh2";
import { PreDispatchError, type HostKeyStore } from "../toolkits/sandbox-ssh2";
import type { PtyStream, TerminalExecResult, TerminalTransport } from "./terminal";

const { Client } = ssh2;
type ClientClass = typeof Client;

/** 15s keepalives notice a dead pooled connection within a minute. */
const KEEPALIVE_INTERVAL_MS = 15_000;
const READY_TIMEOUT_MS = 10_000;
/** A channel that has not opened by now is stalled; the connection is retired. */
const CHANNEL_OPEN_TIMEOUT_MS = 10_000;
/** The page polls every 5s, so this only ends a connection nobody is using. */
const IDLE_TIMEOUT_MS = 5 * 60_000;

export interface Ssh2TerminalTransportOptions {
  host: string;
  port?: number;
  user?: string;
  hostKeys?: HostKeyStore;
  /** End the pooled connection after this long with no open channel. */
  idleTimeoutMs?: number;
}

/** The ssh2 transport plus `close()`, which ends the pooled connection. */
export type Ssh2TerminalTransport = TerminalTransport & { close(): void };

/** TOFU check against the store, the same rule the sandbox toolkit pins by. */
async function verifyHostKey(store: HostKeyStore, host: string, raw: Buffer): Promise<boolean> {
  const hash = `sha256:${createHash("sha256").update(raw).digest("base64")}`;
  const known = await store.get(host);
  if (known === undefined) {
    await store.set(host, hash);
    return true;
  }
  if (known !== hash) {
    throw new Error(
      `Sandbox host key changed for ${host} (pinned ${known}, now ${hash}). ` +
        "Either the VM was reinstalled — clear the pinned key — or the endpoint is being intercepted.",
    );
  }
  return true;
}

function dial(
  options: Ssh2TerminalTransportOptions,
  ClientClass: ClientClass,
): Promise<ssh2.Client> {
  return new Promise((resolve, reject) => {
    const client = new ClientClass();
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      client.end();
      reject(error);
    };
    client
      .on("ready", () => {
        if (!settled) {
          settled = true;
          resolve(client);
        }
      })
      .once("error", fail)
      .once("close", () => fail(new Error("connection closed before ready")))
      .connect({
        host: options.host,
        port: options.port ?? 22,
        username: options.user ?? "exedev",
        keepaliveInterval: KEEPALIVE_INTERVAL_MS,
        readyTimeout: READY_TIMEOUT_MS,
        hostVerifier: options.hostKeys
          ? (key: Buffer, verify: (result: boolean) => void) => {
              void verifyHostKey(options.hostKeys!, options.host, key).then(
                (ok) => verify(ok),
                (error: Error) => {
                  client.end();
                  fail(error);
                  verify(false);
                },
              );
            }
          : undefined,
      } satisfies ConnectConfig);
  });
}

/** One shared connection: its open channels gate the idle close. */
interface Pooled {
  client: ssh2.Client;
  channels: number;
  /** No new channels; ends once the last open one closes. */
  retired: boolean;
  idle?: ReturnType<typeof setTimeout>;
  /** The dial this came from, so dropping it can clear the cached one. */
  source: Promise<Pooled>;
}

/** Open a session channel, bounded so a stalled open cannot hang the caller. */
function openChannel(
  client: ssh2.Client,
  command: string,
  execOptions: ExecOptions | undefined,
): Promise<ClientChannel> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      reject(new Error("Timed out opening an SSH channel to the sandbox"));
    }, CHANNEL_OPEN_TIMEOUT_MS);
    const done = (error: Error | undefined, channel?: ClientChannel) => {
      if (settled) {
        channel?.close(); // a late open after the timeout: nobody wants it
        return;
      }
      settled = true;
      clearTimeout(timer);
      // A refusal (dead connection, channel or exec request denied) happens
      // before the command runs, so retrying it elsewhere is safe.
      if (error) reject(new PreDispatchError(error.message, { cause: error }));
      else resolve(channel!);
    };
    try {
      if (execOptions) client.exec(command, execOptions, done);
      else client.exec(command, done);
    } catch (error) {
      done(error as Error); // "Not connected": the socket is already gone
    }
  });
}

function createClientPool(connect: () => Promise<ssh2.Client>, idleTimeoutMs: number) {
  let current: Promise<Pooled> | undefined;
  const live = new Set<Pooled>();

  /** Stop handing out the connection; it may still carry open channels. */
  const forget = (pooled: Pooled) => {
    pooled.retired = true;
    clearTimeout(pooled.idle);
    if (current === pooled.source) current = undefined;
  };

  const retire = (pooled: Pooled) => {
    forget(pooled);
    if (pooled.channels === 0) pooled.client.end();
  };

  const dialPooled = (): Promise<Pooled> => {
    const source = connect().then((client) => {
      const pooled: Pooled = { client, channels: 0, retired: false, source };
      live.add(pooled);
      // ssh2 emits error then close; either way the connection is unusable,
      // and its channels close with it. The listener also keeps a late error
      // from going unhandled.
      client.on("error", () => forget(pooled));
      client.on("close", () => {
        forget(pooled);
        live.delete(pooled);
      });
      return pooled;
    });
    source.catch(() => {
      if (current === source) current = undefined; // never cache a failed dial
    });
    return source;
  };

  /** A channel slot on the live connection; release it exactly once. */
  const lease = async (): Promise<Pooled> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const source = (current ??= dialPooled());
      const pooled = await source;
      if (!pooled.retired) {
        pooled.channels++;
        clearTimeout(pooled.idle);
        return pooled;
      }
      // Closed between the dial and now: redial once.
      if (current === source) current = undefined;
    }
    throw new Error("SSH connection to the sandbox closed");
  };

  const release = (pooled: Pooled) => {
    pooled.channels--;
    if (pooled.channels > 0) return;
    if (pooled.retired) {
      pooled.client.end();
      return;
    }
    pooled.idle = setTimeout(() => retire(pooled), idleTimeoutMs);
    pooled.idle.unref?.();
  };

  return {
    /** A channel running `command`, plus its release (call once, on close). */
    async open(
      command: string,
      execOptions?: ExecOptions,
    ): Promise<{ channel: ClientChannel; release: () => void }> {
      for (let attempt = 0; ; attempt++) {
        const pooled = await lease();
        let released = false;
        const releaseOnce = () => {
          if (released) return;
          released = true;
          release(pooled);
        };
        try {
          return {
            channel: await openChannel(pooled.client, command, execOptions),
            release: releaseOnce,
          };
        } catch (error) {
          retire(pooled);
          releaseOnce();
          // A refusal never ran the command: retry once on a fresh
          // connection. A stalled open might have, so it surfaces.
          if (!(error instanceof PreDispatchError) || attempt > 0) throw error;
        }
      }
    },
    close() {
      for (const pooled of live) {
        forget(pooled);
        pooled.client.end();
      }
      live.clear();
    },
  };
}

/** Drain a short-lived exec channel into stdout/stderr/exitCode. */
function collect(channel: ClientChannel, release: () => void): Promise<TerminalExecResult> {
  return new Promise((resolve) => {
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    channel.on("data", (b: Buffer) => stdout.push(b));
    channel.stderr.on("data", (b: Buffer) => stderr.push(b));
    channel.on("close", (code: number | null) => {
      release();
      resolve({
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        exitCode: code ?? 255,
      });
    });
    channel.on("error", () => {
      release();
      resolve({ stdout: "", stderr: "ssh channel error", exitCode: 255 });
    });
  });
}

/**
 * A ClientChannel wrapped as a PtyStream: reads and writes pass through to
 * the pty untouched, `setWindow` drives the channel's window-change request,
 * and destroying the stream closes only its channel (the connection is
 * shared with every other tab and exec).
 */
class ChannelDuplex extends Duplex implements PtyStream {
  private ended = false;
  readonly done: Promise<{ exitCode: number | null }>;

  constructor(
    private readonly channel: ClientChannel,
    private readonly release: () => void,
  ) {
    // Not half-open: when the remote side ends (tmux exited, a missing
    // session, another viewer detached us), the stream must close, or the
    // bridge never learns the tab is gone.
    super({ allowHalfOpen: false });
    let resolveDone!: (value: { exitCode: number | null }) => void;
    this.done = new Promise((resolve) => {
      resolveDone = resolve;
    });
    channel.on("data", (b: Buffer) => {
      if (!this.ended) this.push(b);
    });
    channel.once("close", (code: number | null) => {
      this.ended = true;
      this.push(null);
      resolveDone({ exitCode: code });
      this.release();
    });
    channel.on("error", () => {
      this.ended = true;
      this.push(null);
      resolveDone({ exitCode: null });
      this.release();
    });
  }

  setWindow(rows: number, cols: number): void {
    if (this.ended) return;
    this.channel.setWindow(rows, cols, 0, 0);
  }

  override _read(): void {
    this.channel.resume();
  }

  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    if (this.ended) return callback();
    const ok = this.channel.write(chunk);
    if (ok) callback();
    else this.channel.once("drain", () => callback());
  }

  override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    this.ended = true;
    try {
      this.channel.close();
    } catch {
      // The channel can already be gone (its connection closed).
    }
    this.release();
    callback(error);
  }
}

export function createSsh2TerminalTransport(
  options: Ssh2TerminalTransportOptions,
  ClientClass: ClientClass = Client,
): Ssh2TerminalTransport {
  const pool = createClientPool(
    () => dial(options, ClientClass),
    options.idleTimeoutMs ?? IDLE_TIMEOUT_MS,
  );
  return {
    async exec(command) {
      const { channel, release } = await pool.open(command);
      return collect(channel, release);
    },
    async pty(command, init) {
      const { channel, release } = await pool.open(command, {
        pty: { term: init.term, cols: init.cols, rows: init.rows },
      });
      // The channel's slot is released by ChannelDuplex's close/error/destroy.
      return new ChannelDuplex(channel, release);
    },
    close: () => pool.close(),
  };
}
