import { createHash } from "node:crypto";
import ssh2, { type ClientChannel, type ConnectConfig, type SFTPWrapper } from "ssh2";

const { Client } = ssh2;
export type SshClientClass = typeof Client;

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

export class PreDispatchError extends Error {}

export class HostKeyChangedError extends Error {}

export class ChannelStallError extends Error {
  constructor() {
    super("Timed out opening an SSH channel to the sandbox");
  }
}

export class SandboxTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Timed out after ${Math.round(timeoutMs / 1000)}s`);
  }
}

export class ForwardRefusedError extends Error {}

export interface SshEndpoint {
  host: string;
  port?: number;
  user?: string;
  hostKeys?: HostKeyStore;
  privateKey?: string;
  connectTimeoutMs?: number;
  keepaliveIntervalMs?: number;
}

const DEFAULT_SSH_PORT = 22;
export const DEFAULT_SSH_USER = "exedev";

export function hostKeyHash(raw: Buffer): string {
  return `sha256:${createHash("sha256").update(raw).digest("base64")}`;
}

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

export function describeSandboxError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith("Cannot reach the sandbox")) return message;
  return /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH/.test(message)
    ? `Cannot reach the sandbox (${message}). Is it online and on the tailnet?`
    : message;
}

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
      .on("error", fail)
      .once("close", () => fail(new Error("SSH connection closed before ready")))
      .connect({
        host: endpoint.host,
        port: endpoint.port ?? DEFAULT_SSH_PORT,
        username: endpoint.user ?? DEFAULT_SSH_USER,
        keepaliveInterval: endpoint.keepaliveIntervalMs ?? 15_000,
        readyTimeout: endpoint.connectTimeoutMs ?? 10_000,
        hostVerifier: endpoint.hostKeys
          ? (key: Buffer, verify: (result: boolean) => void) => {
              void verifyHostKey(endpoint.hostKeys!, endpoint.host, key).then(
                () => verify(true),
                (error: Error) => {
                  fail(error);
                  verify(false);
                },
              );
            }
          : undefined,
        ...(endpoint.privateKey ? { privateKey: endpoint.privateKey } : {}),
      } satisfies ConnectConfig);
  });
}

export const CHANNEL_OPEN_TIMEOUT_MS = 10_000;

const OPEN_CONNECT_FAILED = 2;

export interface OpenOptions<T> {
  timeoutMs?: number;
  onOpen?: (channel: T) => void;
}

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
      done(error as Error);
    }
  });
}

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
