/**
 * The dial layer under the sandbox connection (`sandbox-connection.ts`): the
 * endpoint, the defaults, TOFU host keys, the handshake and the bounded
 * channel opens. Nothing outside `ssh/` uses it; toolkits, transports and the
 * Claude worker take a `SandboxConnection`.
 *
 * - Auth is absent by default: Tailscale SSH terminates at the node and the
 *   tailnet's `accept` rules are the identity check, so ssh2 connects with no
 *   credentials and expects `none` auth to succeed. An endpoint with a
 *   `privateKey` (the local sandbox container, `docker/sandbox/`) uses
 *   public-key auth instead, for hosts that can't join the tailnet.
 * - TOFU host-key pinning against one injected `HostKeyStore`: the first
 *   connection to a host remembers its key hash, a changed key refuses the
 *   handshake. No store = accept (WireGuard already authenticates the
 *   endpoint); pinning is defense in depth.
 * - The `error` listener stays for the connection's whole life: after a
 *   handshake timeout ssh2 emits a second, fatal "Connection lost" error,
 *   and an unhandled `error` event would take the whole server down.
 * - `PreDispatchError` marks a failure raised before a command was dispatched
 *   on the wire, which may be retried on a fresh connection without doubling
 *   a side effect.
 */
import { createHash } from "node:crypto";
import ssh2, { type ClientChannel, type ConnectConfig, type SFTPWrapper } from "ssh2";

const { Client } = ssh2;
export type SshClientClass = typeof Client;

/** TOFU host-key store: remember one key hash per host, reject changes. */
export interface HostKeyStore {
  get(host: string): Promise<string | undefined>;
  set(host: string, hash: string): Promise<void>;
}

export function createMemoryHostKeyStore(): HostKeyStore {
  const map = new Map<string, string>();
  return {
    get: async (host) => map.get(host),
    set: async (host, hash) => void map.set(host, hash),
  };
}

/**
 * A connection-level failure raised before a command or transfer was
 * dispatched on the wire: safe to retry on a fresh connection because
 * nothing has started. Anything after dispatch is a different failure and
 * must surface, honoring the tools' `unsafe` replay contract.
 */
export class PreDispatchError extends Error {}

/** The pinned key and the one the host presented differ: never retried. */
export class HostKeyChangedError extends Error {}

/** A channel that did not open in time; its connection is retired. */
export class ChannelStallError extends Error {
  constructor() {
    super("Timed out opening an SSH channel to the sandbox");
  }
}

/** A command ran past its `timeoutMs`; its channel was closed. */
export class SandboxTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Timed out after ${Math.round(timeoutMs / 1000)}s`);
  }
}

/** A forward to a port nothing listens on: the connection itself is fine. */
export class ForwardRefusedError extends Error {}

/** Where to dial: the sandbox VM as the app configures it. */
export interface SshEndpoint {
  host: string;
  port?: number;
  /** Unix user for the session; must match the ACL rule's `users`. Default `exedev`. */
  user?: string;
  hostKeys?: HostKeyStore;
  /** OpenSSH private key for public-key auth (a local sandbox container); unset = keyless Tailscale SSH. */
  privateKey?: string;
  connectTimeoutMs?: number;
  /** Default 15s: a dead connection is noticed within a minute. */
  keepaliveIntervalMs?: number;
}

const DEFAULT_SSH_PORT = 22;
const DEFAULT_SSH_USER = "exedev";

/** The pinned form of a host key: `sha256:<base64>`. */
export function hostKeyHash(raw: Buffer): string {
  return `sha256:${createHash("sha256").update(raw).digest("base64")}`;
}

/** The TOFU rule: pin on first sight, accept the same key, refuse a change. */
async function verifyHostKey(store: HostKeyStore, host: string, raw: Buffer): Promise<void> {
  const hash = hostKeyHash(raw);
  const known = await store.get(host);
  if (known === undefined) {
    await store.set(host, hash);
    return;
  }
  if (known !== hash) {
    throw new HostKeyChangedError(
      `Sandbox host key changed for ${host} (pinned ${known}, now ${hash}). ` +
        "Either the VM was reinstalled (clear the pinned key) or the endpoint is being intercepted.",
    );
  }
}

/**
 * The one wording for a sandbox that can't be reached. Network failures read
 * "Cannot reach the sandbox (…)"; anything else keeps its own message. Errors
 * can pass through more than one layer, so it never wraps twice.
 */
export function describeSandboxError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith("Cannot reach the sandbox")) return message;
  return /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH/.test(message)
    ? `Cannot reach the sandbox (${message}). Is it online and on the tailnet?`
    : message;
}

/**
 * Dial the endpoint; resolves with a ready client, rejects on any failure
 * before ready (and ends the client). The client keeps an `error` listener
 * for life, so a late ssh2 error never goes unhandled.
 */
export function dialSsh(
  endpoint: SshEndpoint,
  ClientClass: SshClientClass = Client,
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
        if (settled) return;
        settled = true;
        resolve(client);
      })
      // Stays subscribed after ready: a second error (the one after a
      // handshake timeout, a dropped link later) is handled, not thrown.
      .on("error", fail)
      .once("close", () => fail(new Error("SSH connection closed before ready")))
      .connect({
        host: endpoint.host,
        port: endpoint.port ?? DEFAULT_SSH_PORT,
        username: endpoint.user ?? DEFAULT_SSH_USER,
        keepaliveInterval: endpoint.keepaliveIntervalMs ?? 15_000,
        readyTimeout: endpoint.connectTimeoutMs ?? 10_000,
        // The TOFU check runs inside ssh2's verifier: returning false aborts
        // the handshake before any channel opens.
        hostVerifier: endpoint.hostKeys
          ? (key: Buffer, verify: (result: boolean) => void) => {
              void verifyHostKey(endpoint.hostKeys!, endpoint.host, key).then(
                () => verify(true),
                (error: Error) => {
                  // A changed key, or a store failure: refuse this connection.
                  fail(error);
                  verify(false);
                },
              );
            }
          : undefined,
        // No key: the tailnet is the authentication. A key: public-key auth.
        ...(endpoint.privateKey ? { privateKey: endpoint.privateKey } : {}),
      } satisfies ConnectConfig);
  });
}

/** A channel that has not opened by now is stalled; the connection is retired. */
export const CHANNEL_OPEN_TIMEOUT_MS = 10_000;

/** SSH_OPEN_CONNECT_FAILED: the far side could not reach the forward's port. */
const OPEN_CONNECT_FAILED = 2;

/** How a channel open is bounded and handed over. */
export interface OpenOptions<T> {
  timeoutMs?: number;
  /**
   * Called synchronously with the open channel, before the promise settles:
   * ssh2 can emit a fast command's `exit` in the same parse loop as the open
   * callback, so listeners attached after an `await` would miss it.
   */
  onOpen?: (channel: T) => void;
}

/**
 * Open one channel, bounded so a stalled open cannot hang the caller. A
 * refusal (dead connection, channel or exec request denied) happens before
 * anything runs, so it rejects as `PreDispatchError`; a stall rejects as
 * `ChannelStallError`.
 */
function boundedOpen<T>(
  start: (done: (error: Error | undefined, value?: T) => void) => void,
  discard: (value: T) => void,
  { timeoutMs = CHANNEL_OPEN_TIMEOUT_MS, onOpen }: OpenOptions<T>,
  refusal: (error: Error) => Error = (error) =>
    new PreDispatchError(error.message, { cause: error }),
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      reject(new ChannelStallError());
    }, timeoutMs);
    const done = (error: Error | undefined, value?: T) => {
      if (settled) {
        // A late open after the timeout: nobody wants it.
        if (value) discard(value);
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (error) {
        reject(refusal(error));
        return;
      }
      onOpen?.(value!);
      resolve(value!);
    };
    try {
      start(done);
    } catch (error) {
      done(error as Error); // "Not connected": the socket is already gone
    }
  });
}

/** A session channel running `command`, with a pty when `pty` is given. */
export function openExecChannel(
  client: ssh2.Client,
  command: string,
  options: OpenOptions<ClientChannel> & { pty?: { term: string; cols: number; rows: number } } = {},
): Promise<ClientChannel> {
  const { pty } = options;
  return boundedOpen<ClientChannel>(
    (done) => (pty ? client.exec(command, { pty }, done) : client.exec(command, done)),
    (channel) => channel.close(),
    options,
  );
}

/** An SFTP subsystem channel. */
export function openSftpChannel(
  client: ssh2.Client,
  options: OpenOptions<SFTPWrapper> = {},
): Promise<SFTPWrapper> {
  return boundedOpen<SFTPWrapper>(
    (done) => client.sftp(done),
    (sftp) => sftp.end(),
    options,
  );
}

/** A direct-tcpip channel to `port` on the sandbox's loopback. */
export function openForwardChannel(
  client: ssh2.Client,
  port: number,
  options: OpenOptions<ClientChannel> = {},
): Promise<ClientChannel> {
  return boundedOpen<ClientChannel>(
    (done) => client.forwardOut("127.0.0.1", 0, "127.0.0.1", port, done),
    (channel) => channel.close(),
    options,
    (error) =>
      (error as { reason?: number }).reason === OPEN_CONNECT_FAILED
        ? new ForwardRefusedError(`Nothing is listening on port ${port} on the sandbox`, {
            cause: error,
          })
        : new PreDispatchError(error.message, { cause: error }),
  );
}
