/**
 * The ssh2 binding for the terminal transport (issue #28): an adapter over
 * the shared SSH connection module (`../ssh/connection`) that runs tmux
 * commands on the sandbox VM and opens tmux attaches as pty channels over
 * one pooled connection (issue #84). The dial, the host-key pinning and the
 * pool are the connection module's; this file turns channels into exec
 * results and pty streams.
 */
import { Duplex } from "node:stream";
import type { ClientChannel } from "ssh2";
import {
  createSshChannelPool,
  dialSsh,
  type HostKeyStore,
  type SshClientClass,
} from "../ssh/connection";
import type { PtyStream, TerminalExecResult, TerminalTransport } from "./terminal";

/** The page polls every 5s, so this only ends a connection nobody is using. */
const IDLE_TIMEOUT_MS = 5 * 60_000;

export interface Ssh2TerminalTransportOptions {
  host: string;
  port?: number;
  user?: string;
  hostKeys?: HostKeyStore;
  /** OpenSSH private key for public-key auth (a local sandbox container); unset = keyless Tailscale SSH. */
  privateKey?: string;
  /** End the pooled connection after this long with no open channel. */
  idleTimeoutMs?: number;
}

/** The ssh2 transport plus `close()`, which ends the pooled connection. */
export type Ssh2TerminalTransport = TerminalTransport & { close(): void };

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
    // session, the tmux client was detached), the stream must close, or the
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
  ClientClass?: SshClientClass,
): Ssh2TerminalTransport {
  const pool = createSshChannelPool(
    () =>
      dialSsh(
        {
          host: options.host,
          port: options.port,
          user: options.user,
          hostKeys: options.hostKeys,
          privateKey: options.privateKey,
        },
        ClientClass,
      ),
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
