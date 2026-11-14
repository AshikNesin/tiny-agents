/**
 * The sandbox connection: everything that reaches the sandbox VM (or the
 * local sandbox container) goes through one of these, built once from the
 * endpoint in the app's composition root. The sandbox toolkit, attachments,
 * the terminal, the computer, the browser and the Claude worker take the
 * connection, never an endpoint.
 *
 * Behind its small interface (exec, pty, readFile, writeFile, forward,
 * close) sit the rules every user used to pick for itself:
 *
 * - One channel pool. Channels share one lazily dialed client (a tailnet
 *   handshake costs about 2s); concurrent first callers share the in-flight
 *   dial; a client that errors or closes is dropped and the next call
 *   redials; the client ends after `idleTimeoutMs` with no open channel.
 * - The retry rule. A failed dial is redialed once (handshakes over the
 *   tailnet occasionally stall), except for a changed host key. A channel
 *   that is refused, or does not open in time, retires its connection: new
 *   channels go to a fresh one and the retired one ends once its last
 *   channel closes. A refusal never ran anything, so it is retried once on
 *   a fresh connection; a stalled exec or pty open might have, so it
 *   surfaces, while a stalled SFTP or forward open (nothing runs) is retried.
 *   Anything after dispatch surfaces, honoring the tools' `unsafe` replay
 *   contract.
 * - The tailscaled rule. Tailscale's SSH server stalls new channels on a
 *   connection after a direct-tcpip channel on it has closed, so a closed
 *   forward retires its connection (long-lived channels on it carry on).
 * - TOFU host keys and the defaults (`connection.ts`), and one wording for
 *   "Cannot reach the sandbox".
 */
import type { Duplex } from "node:stream";
import type ssh2 from "ssh2";
import type { ClientChannel, SFTPWrapper } from "ssh2";
import {
  CHANNEL_OPEN_TIMEOUT_MS,
  ChannelStallError,
  describeSandboxError,
  dialSsh,
  ForwardRefusedError,
  HostKeyChangedError,
  openExecChannel,
  openForwardChannel,
  openSftpChannel,
  PreDispatchError,
  SandboxTimeoutError,
  type SshEndpoint,
} from "./connection";
import { ChannelPtyStream, type PtySize, type PtyStream } from "./pty-stream";
import { readCapped, writeAtomic } from "./sftp";
import { EXIT_NO_STATUS } from "../shell";

export interface SandboxExecOptions {
  /** Written to the command's stdin, which is then closed (closed empty when unset). */
  stdin?: string | Uint8Array;
  /** Default 120s. Past it the channel is closed and the call rejects with `SandboxTimeoutError`. */
  timeoutMs?: number;
  /** Bytes kept of stdout and of stderr, each; the rest is dropped. Default 16 MiB. */
  maxBytes?: number;
  /**
   * Settle 50ms after the command exits instead of when its channel closes,
   * for commands that leave a child holding the channel (a launched app,
   * xclip, a backgrounded server). The channel is then closed.
   */
  settleOnExit?: boolean;
}

export interface SandboxExecResult {
  stdout: Buffer;
  stderr: string;
  /** 255 when the command died by a signal or the channel closed without a status. */
  exitCode: number;
  /** Output past `maxBytes` was dropped. */
  truncated: boolean;
}

export interface SandboxFile {
  /** At most `maxBytes`. */
  bytes: Buffer;
  /** Bytes read before stopping (just past `maxBytes` when truncated). */
  size: number;
  truncated: boolean;
}

/** What every sandbox user sees of SSH. */
export interface SandboxConnection {
  /** The sandbox's host, for display (never a secret). */
  readonly host: string;
  /** Run one command and collect its output. */
  exec(command: string, options?: SandboxExecOptions): Promise<SandboxExecResult>;
  /** Run a command on a pty; closing the stream closes only its channel. */
  pty(command: string, size: PtySize): Promise<PtyStream>;
  /** Read a file over SFTP (paths relative to the user's home). Default cap 200 KB. */
  readFile(path: string, options?: { maxBytes?: number }): Promise<SandboxFile>;
  /** Write a file atomically over SFTP: a temp name, then a rename. */
  writeFile(path: string, content: string | Uint8Array): Promise<void>;
  /**
   * A stream to `port` on the sandbox's loopback (the browser's CDP and VNC,
   * the desktop's VNC, the Claude worker). A port nothing listens on rejects
   * with `ForwardRefusedError` and leaves the connection alone.
   */
  forward(port: number): Promise<Duplex>;
  /** End every connection; later calls reject. */
  close(): void;
}

export interface SandboxConnectionOptions {
  /** End a connection after this long with no open channel. Default 5 minutes. */
  idleTimeoutMs?: number;
  /** A channel not open by then is stalled. Default 10s. */
  channelOpenTimeoutMs?: number;
}

/** Long enough that the terminal's 5s poll and a run of tool calls keep one connection. */
const SANDBOX_IDLE_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_EXEC_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_BYTES = 16 * 1024 * 1024;
const DEFAULT_READ_BYTES = 200_000;
/** How long `settleOnExit` waits for output still in flight after the exit status. */
const EXIT_GRACE_MS = 50;

/** One dialed client: its open channels gate the idle close. */
interface Pooled {
  client: ssh2.Client;
  channels: number;
  /** No new channels; ends once the last open one closes. */
  retired: boolean;
  idle?: ReturnType<typeof setTimeout>;
  /** The dial this came from, so dropping it can clear the cached one. */
  source: Promise<Pooled>;
}

/** A channel slot on a pooled client. Release it once, when the channel closes. */
interface Lease {
  client: ssh2.Client;
  release(): void;
  /** Stop handing out this connection (it ends once its channels close). */
  retire(): void;
}

export function createSandboxConnection(
  endpoint: SshEndpoint,
  options: SandboxConnectionOptions = {},
): SandboxConnection {
  const idleTimeoutMs = options.idleTimeoutMs ?? SANDBOX_IDLE_TIMEOUT_MS;
  const timeoutMs = options.channelOpenTimeoutMs ?? CHANNEL_OPEN_TIMEOUT_MS;
  let current: Promise<Pooled> | undefined;
  const live = new Set<Pooled>();
  let closed = false;

  const closedError = () => new Error("The sandbox connection is closed.");

  /** Dial, redialing once; failures carry the one "Cannot reach the sandbox" wording. */
  const dial = async (): Promise<ssh2.Client> => {
    try {
      return await dialSsh(endpoint);
    } catch (first) {
      if (first instanceof HostKeyChangedError || closed) throw first;
      try {
        return await dialSsh(endpoint);
      } catch (error) {
        if (error instanceof HostKeyChangedError) throw error;
        throw new Error(describeSandboxError(error), { cause: error });
      }
    }
  };

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
    const source: Promise<Pooled> = dial().then((client) => {
      if (closed) {
        client.end();
        throw closedError();
      }
      const pooled: Pooled = { client, channels: 0, retired: false, source };
      live.add(pooled);
      // ssh2 emits error then close; either way the connection is unusable,
      // and its channels close with it (dialSsh keeps the error handled).
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

  /** A slot on the live connection. */
  const lease = async (): Promise<Lease> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (closed) throw closedError();
      const source = (current ??= dialPooled());
      const pooled = await source;
      if (!pooled.retired) {
        pooled.channels++;
        clearTimeout(pooled.idle);
        let released = false;
        return {
          client: pooled.client,
          release: () => {
            if (released) return;
            released = true;
            release(pooled);
          },
          retire: () => retire(pooled),
        };
      }
      // Closed between the dial and now: redial once.
      if (current === source) current = undefined;
    }
    throw new Error("SSH connection to the sandbox closed");
  };

  /**
   * Open a channel under the retry rule. On success the opener owns the
   * lease and releases it when its channel closes; on failure it is
   * released here.
   */
  const withChannel = async (
    kind: "session" | "transfer",
    open: (lease: Lease) => Promise<unknown>,
  ): Promise<void> => {
    for (let attempt = 0; ; attempt++) {
      const slot = await lease();
      try {
        await open(slot);
        return;
      } catch (error) {
        if (error instanceof ForwardRefusedError) {
          slot.release(); // the connection is fine; the port is closed
          throw error;
        }
        slot.retire();
        slot.release();
        const retryable =
          error instanceof PreDispatchError ||
          (kind === "transfer" && error instanceof ChannelStallError);
        if (!retryable || attempt > 0) throw error;
      }
    }
  };

  const withSftp = async <T>(fn: (sftp: SFTPWrapper) => Promise<T>): Promise<T> => {
    let sftp!: SFTPWrapper;
    await withChannel("transfer", (slot) =>
      openSftpChannel(slot.client, {
        timeoutMs,
        onOpen: (s) => {
          sftp = s;
          s.once("close", slot.release);
        },
      }),
    );
    try {
      return await fn(sftp);
    } finally {
      sftp.end(); // never leak the channel on the shared connection
    }
  };

  return {
    host: endpoint.host,

    async exec(command, execOptions = {}) {
      let result!: Promise<SandboxExecResult>;
      await withChannel("session", (slot) =>
        openExecChannel(slot.client, command, {
          timeoutMs,
          onOpen: (channel) => {
            result = collect(channel, execOptions, slot.release);
          },
        }),
      );
      return result;
    },

    async pty(command, size) {
      let stream!: PtyStream;
      await withChannel("session", (slot) =>
        openExecChannel(slot.client, command, {
          timeoutMs,
          pty: { term: size.term, cols: size.cols, rows: size.rows },
          onOpen: (channel) => {
            // The stream releases the slot on close, error or destroy.
            stream = new ChannelPtyStream(channel, slot.release);
          },
        }),
      );
      return stream;
    },

    readFile(path, readOptions) {
      return withSftp((sftp) =>
        readCapped(sftp, path, readOptions?.maxBytes ?? DEFAULT_READ_BYTES),
      );
    },

    writeFile(path, content) {
      return withSftp((sftp) => writeAtomic(sftp, path, content));
    },

    async forward(port) {
      let tunnel!: ClientChannel;
      await withChannel("transfer", (slot) =>
        openForwardChannel(slot.client, port, {
          timeoutMs,
          onOpen: (channel) => {
            tunnel = channel;
            channel.once("close", () => {
              slot.retire(); // the tailscaled rule
              slot.release();
            });
          },
        }),
      );
      return tunnel;
    },

    close() {
      closed = true;
      current = undefined;
      for (const pooled of live) {
        forget(pooled);
        pooled.client.end();
      }
      live.clear();
    },
  };
}

/** Drain an exec channel into a result, bounded by time and size. */
function collect(
  channel: ClientChannel,
  options: SandboxExecOptions,
  release: () => void,
): Promise<SandboxExecResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  return new Promise((resolve, reject) => {
    let truncated = false;
    let settled = false;
    let grace: ReturnType<typeof setTimeout> | undefined;
    const sink = () => {
      const chunks: Buffer[] = [];
      let kept = 0;
      return {
        chunks,
        push(chunk: Buffer) {
          const room = maxBytes - kept;
          if (room > 0) {
            const part = chunk.length > room ? chunk.subarray(0, room) : chunk;
            chunks.push(part);
            kept += part.length;
          }
          if (chunk.length > room) truncated = true;
        },
      };
    };
    const stdout = sink();
    const stderr = sink();
    const result = (code: number | null | undefined): SandboxExecResult => ({
      stdout: Buffer.concat(stdout.chunks),
      stderr: Buffer.concat(stderr.chunks).toString("utf8"),
      exitCode: code ?? EXIT_NO_STATUS,
      truncated,
    });
    const settle = (finish: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(grace);
      finish();
    };
    const closeChannel = () => {
      try {
        channel.close();
      } catch {
        // Already gone with its connection.
      }
    };
    const timer = setTimeout(
      () =>
        settle(() => {
          closeChannel();
          reject(new SandboxTimeoutError(timeoutMs));
        }),
      timeoutMs,
    );
    channel.on("data", (chunk: Buffer) => stdout.push(chunk));
    channel.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    channel.on("exit", (code: number | null) => {
      if (!options.settleOnExit) return;
      grace = setTimeout(
        () =>
          settle(() => {
            closeChannel();
            resolve(result(code));
          }),
        EXIT_GRACE_MS,
      );
    });
    channel.once("close", (code: number | null) => {
      release();
      settle(() => resolve(result(code)));
    });
    channel.on("error", (error: Error) =>
      settle(() => {
        closeChannel();
        reject(error);
      }),
    );
    // Secrets and typed text arrive here, never on the command line.
    if (options.stdin !== undefined) channel.end(options.stdin);
    else channel.end();
  });
}
