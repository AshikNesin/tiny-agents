/**
 * One SSH connection module for everything that reaches the sandbox VM: the
 * sandbox toolkit's exec/SFTP session, the terminal's tmux channels and the
 * browser's CDP/VNC tunnels. Each is an adapter over the same dial, so the
 * rules hold in one place:
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
 *   on the wire, which a caller may retry on a fresh connection without
 *   doubling a side effect.
 */
import { createHash } from "node:crypto";
import ssh2, { type ClientChannel, type ConnectConfig, type ExecOptions } from "ssh2";

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

export const DEFAULT_SSH_PORT = 22;
export const DEFAULT_SSH_USER = "exedev";

/** The pinned form of a host key: `sha256:<base64>`. */
export function hostKeyHash(raw: Buffer): string {
  return `sha256:${createHash("sha256").update(raw).digest("base64")}`;
}

/** The TOFU rule: pin on first sight, accept the same key, refuse a change. */
export async function verifyHostKey(store: HostKeyStore, host: string, raw: Buffer): Promise<void> {
  const hash = hostKeyHash(raw);
  const known = await store.get(host);
  if (known === undefined) {
    await store.set(host, hash);
    return;
  }
  if (known !== hash) {
    throw new Error(
      `Sandbox host key changed for ${host} (pinned ${known}, now ${hash}). ` +
        "Either the VM was reinstalled — clear the pinned key — or the endpoint is being intercepted.",
    );
  }
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

/** Open a session channel, bounded so a stalled open cannot hang the caller. */
export function openSshChannel(
  client: ssh2.Client,
  command: string,
  execOptions?: ExecOptions,
  timeoutMs = CHANNEL_OPEN_TIMEOUT_MS,
): Promise<ClientChannel> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      reject(new Error("Timed out opening an SSH channel to the sandbox"));
    }, timeoutMs);
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

export interface SshChannelPool {
  /** A channel running `command`, plus its release (call once, on close). */
  open(
    command: string,
    execOptions?: ExecOptions,
  ): Promise<{ channel: ClientChannel; release: () => void }>;
  /** End every pooled connection. */
  close(): void;
}

/**
 * One pooled connection shared by many channels. A fresh handshake over the
 * tailnet costs about 2s, so exec and pty channels share one lazily dialed
 * client: concurrent first callers share the in-flight dial; a client that
 * closes or errors is dropped and the next call redials; the client ends
 * after `idleTimeoutMs` with no open channel. A channel that is refused or
 * does not open in time retires the connection: new channels go to a fresh
 * one, and the retired one ends once its last channel closes.
 */
export function createSshChannelPool(
  dial: () => Promise<ssh2.Client>,
  idleTimeoutMs: number,
): SshChannelPool {
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
    const source = dial().then((client) => {
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
    async open(command, execOptions) {
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
            channel: await openSshChannel(pooled.client, command, execOptions),
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
