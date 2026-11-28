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
import { ChannelPtyStream, closeChannel, type PtySize, type PtyStream } from "./pty-stream";
import { callerSeesRejection } from "../failures";
import { readCapped, writeAtomic } from "./sftp";
import { EXIT_NO_STATUS } from "../shell";

export interface SandboxExecOptions {
  stdin?: string | Uint8Array;
  timeoutMs?: number;
  maxBytes?: number;
  settleOnExit?: boolean;
  signal?: AbortSignal;
}

export interface SandboxExecResult {
  stdout: Buffer;
  stderr: string;
  exitCode: number;
  truncated: boolean;
}

export interface SandboxFile {
  bytes: Buffer;
  size: number;
  truncated: boolean;
}

export interface SandboxConnection {
  readonly host: string;
  exec(command: string, options?: SandboxExecOptions): Promise<SandboxExecResult>;
  pty(command: string, size: PtySize): Promise<PtyStream>;
  readFile(path: string, options?: { maxBytes?: number }): Promise<SandboxFile>;
  writeFile(path: string, content: string | Uint8Array): Promise<void>;
  forward(port: number): Promise<Duplex>;
  close(): void;
}

export interface SandboxConnectionOptions {
  idleTimeoutMs?: number;
  channelOpenTimeoutMs?: number;
}

const SANDBOX_IDLE_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_EXEC_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_BYTES = 16 * 1024 * 1024;
const DEFAULT_READ_BYTES = 200_000;
const EXIT_GRACE_MS = 50;

interface Pooled {
  client: ssh2.Client;
  channels: number;
  retired: boolean;
  idle?: ReturnType<typeof setTimeout>;
  source: Promise<Pooled>;
}

interface Lease {
  client: ssh2.Client;
  release(): void;
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
      client.on("error", () => forget(pooled));
      client.on("close", () => {
        forget(pooled);
        live.delete(pooled);
      });
      return pooled;
    });
    source.catch(
      callerSeesRejection(() => {
        if (current === source) current = undefined;
      }),
    );
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
      if (current === source) current = undefined;
    }
    throw new Error("SSH connection to the sandbox closed");
  };

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
          slot.release();
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
      sftp.end();
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
              slot.retire();
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
      options.signal?.removeEventListener("abort", stopped);
      finish();
    };
    const timer = setTimeout(
      () =>
        settle(() => {
          closeChannel(channel);
          reject(new SandboxTimeoutError(timeoutMs));
        }),
      timeoutMs,
    );
    const stopped = () =>
      settle(() => {
        closeChannel(channel);
        reject(new Error("Stopped before the command finished."));
      });
    if (options.signal?.aborted) stopped();
    else options.signal?.addEventListener("abort", stopped, { once: true });
    channel.on("data", (chunk: Buffer) => stdout.push(chunk));
    channel.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    channel.on("exit", (code: number | null) => {
      if (!options.settleOnExit) return;
      grace = setTimeout(
        () =>
          settle(() => {
            closeChannel(channel);
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
        closeChannel(channel);
        reject(error);
      }),
    );
    if (options.stdin !== undefined) channel.end(options.stdin);
    else channel.end();
  });
}
