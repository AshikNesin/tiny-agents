/**
 * The ssh2 binding for the terminal transport (issue #28): runs tmux
 * commands on the sandbox VM over keyless Tailscale SSH (the same dial /
 * TOFU / none-auth posture as the sandbox toolkit) and opens tmux attaches
 * as pty channels.
 *
 * No pooling. Every exec dials a fresh connection, and every pty attach
 * gets a dedicated one that lives exactly as long as the stream. This is
 * deliberate: the tailnet's SSH multiplexing stalls later channels on a
 * connection after a streaming channel closes (the bug
 * browser-remote-cdp.ts already works around the same way), and an attach
 * is long-lived streaming, so sharing would starve the execs around it.
 */
import { createHash } from "node:crypto";
import { Duplex } from "node:stream";
import ssh2, { type ClientChannel, type ConnectConfig } from "ssh2";
import type { HostKeyStore } from "../toolkits/sandbox-ssh2";
import type { PtyStream, TerminalExecResult, TerminalTransport } from "./terminal";

const { Client } = ssh2;

/** Exec channels are short; 15s keepalives hold nothing open past them. */
const KEEPALIVE_INTERVAL_MS = 15_000;
const READY_TIMEOUT_MS = 10_000;

export interface Ssh2TerminalTransportOptions {
  host: string;
  port?: number;
  user?: string;
  hostKeys?: HostKeyStore;
}

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

function dial(options: Ssh2TerminalTransportOptions): Promise<ssh2.Client> {
  return new Promise((resolve, reject) => {
    const client = new Client();
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

/** Drain a short-lived exec channel into stdout/stderr/exitCode. */
function collect(channel: ClientChannel, client: ssh2.Client): Promise<TerminalExecResult> {
  return new Promise((resolve) => {
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    channel.on("data", (b: Buffer) => stdout.push(b));
    channel.stderr.on("data", (b: Buffer) => stderr.push(b));
    channel.on("close", (code: number | null) => {
      client.end();
      resolve({
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        exitCode: code ?? 255,
      });
    });
    channel.on("error", () => {
      client.end();
      resolve({ stdout: "", stderr: "ssh channel error", exitCode: 255 });
    });
  });
}

/**
 * A ClientChannel wrapped as a PtyStream: reads and writes pass through to
 * the pty untouched, `setWindow` drives the channel's window-change request,
 * and destroying the stream ends the whole SSH client (each attach owns its
 * connection, so nothing else shares it).
 */
class ChannelDuplex extends Duplex implements PtyStream {
  private ended = false;
  readonly done: Promise<{ exitCode: number | null }>;

  constructor(
    private readonly channel: ClientChannel,
    private readonly client: ssh2.Client,
  ) {
    super({});
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
      this.client.end();
    });
    channel.on("error", () => {
      this.ended = true;
      this.push(null);
      resolveDone({ exitCode: null });
      this.client.end();
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
      // The channel can already be gone (client ended it); the client end
      // below is what matters.
    }
    this.client.end();
    callback(error);
  }
}

export function createSsh2TerminalTransport(
  options: Ssh2TerminalTransportOptions,
): TerminalTransport {
  return {
    async exec(command) {
      const client = await dial(options);
      return new Promise((resolve, reject) => {
        client.exec(command, (error, channel) => {
          if (error) {
            client.end();
            reject(error);
            return;
          }
          collect(channel, client).then(resolve, reject);
        });
      });
    },
    async pty(command, init) {
      const client = await dial(options);
      return new Promise((resolve, reject) => {
        client.exec(
          command,
          { pty: { term: init.term, cols: init.cols, rows: init.rows } },
          (error, channel) => {
            if (error) {
              client.end();
              reject(error);
              return;
            }
            resolve(new ChannelDuplex(channel, client));
          },
        );
      });
      // The client is closed by ChannelDuplex's close/error/destroy.
    },
  };
}
