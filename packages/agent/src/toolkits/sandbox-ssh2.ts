/**
 * The ssh2 binding behind the sandbox toolkit. Everything here is a narrow
 * port so the toolkit never touches ssh2 types directly:
 *
 * - `SandboxSession.exec/readFile/writeFile` — what the tools need, nothing more.
 * - `SandboxTransport` — `connect(options)`, substitutable in tests.
 * - `HostKeyStore` — TOFU pinning (one key hash per host), substitutable.
 *
 * Auth is intentionally absent: Tailscale SSH terminates at the node and the
 * tailnet's `accept` rules are the identity check, so ssh2 connects with no
 * credentials and expects `none` auth to succeed.
 */
import { createHash, randomBytes } from "node:crypto";
import ssh2, { type ClientChannel, type ConnectConfig, type SFTPWrapper } from "ssh2";
const { Client } = ssh2;
type ClientClass = typeof Client;

export type {
  ConnectOptions,
  ExecOptions,
  ExecResult,
  SandboxSession,
  SandboxTransport,
} from "./sandbox";

/**
 * A connection-level failure raised before a command or transfer was
 * dispatched on the wire: safe to retry on a fresh connection because
 * nothing has started. Anything after dispatch is a different failure and
 * must surface, honoring the tools' `unsafe` replay contract.
 */
export class PreDispatchError extends Error {}
import type { ConnectOptions, ExecResult, SandboxSession, SandboxTransport } from "./sandbox";

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
 * The production transport: one ssh2 Client, `none` auth, 15s keepalive,
 * TOFU host-key check against the injected store.
 */
export function createSsh2Transport(ClientClass: ClientClass = Client): SandboxTransport {
  return (options) =>
    new Promise((resolve, reject) => {
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
            resolve(createSession(client));
          }
        })
        .once("error", fail)
        .once("close", () => fail(new Error("connection closed before ready")))
        .connect({
          host: options.host,
          port: options.port,
          username: options.user,
          keepaliveInterval: 15_000,
          readyTimeout: options.connectTimeoutMs ?? 10_000,
          // TOFU host-key check runs inside ssh2's verifier: returning false
          // aborts the handshake before any channel opens. No store = accept
          // (WireGuard already authenticates the tailnet endpoint).
          hostVerifier: options.hostKeys
            ? (key: Buffer, verify: (result: boolean) => void) => {
                void checkHostKey(options, key).then(
                  (ok) => verify(ok),
                  // a store failure must not break connectivity: pinning is
                  // defense-in-depth over WireGuard's own endpoint auth
                  (error: Error) => {
                    client.end();
                    fail(error);
                    verify(false);
                  },
                );
              }
            : undefined,
          // no privateKey, no password: the tailnet is the authentication
        } satisfies ConnectConfig);
    });
}

async function checkHostKey(options: ConnectOptions, raw: Buffer): Promise<boolean> {
  const store = options.hostKeys!;
  const hash = `sha256:${createHash("sha256").update(raw).digest("base64")}`;
  const known = await store.get(options.host);
  if (known === undefined) {
    await store.set(options.host, hash);
    return true;
  }
  if (known !== hash) {
    throw new Error(
      `Sandbox host key changed for ${options.host} (pinned ${known}, now ${hash}). ` +
        "Either the VM was reinstalled — clear the pinned key — or the endpoint is being intercepted.",
    );
  }
  return true;
}

function createSession(client: ssh2.Client): SandboxSession {
  const sftp = (): Promise<SFTPWrapper> =>
    new Promise((resolve, reject) =>
      client.sftp((error, s) => (error ? reject(error) : resolve(s))),
    );

  return {
    exec(command, options) {
      return new Promise((resolve, reject) => {
        // A refusal here (dead pooled connection, channel open denied) happens
        // before the command runs anywhere — mark it retry-safe.
        client.exec(command, (error, channel) => {
          if (error) return reject(new PreDispatchError(error.message, { cause: error }));
          collect(channel, options?.timeoutMs ?? 120_000).then(resolve, reject);
        });
      });
    },

    async readFile(path, options) {
      const s = await sftp();
      try {
        return await readAll(s, path, options?.maxBytes ?? 200_000);
      } finally {
        s.end(); // never leak the channel on the pooled connection
      }
    },

    async writeFile(path, content) {
      const s = await sftp();
      try {
        await writeAtomic(s, path, content);
      } finally {
        s.end();
      }
    },

    close() {
      client.end();
    },
  };
}

async function readAll(
  s: SFTPWrapper,
  path: string,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean }> {
  {
    const readSize = Math.min(maxBytes + 1, 65_536);
    const buffer = Buffer.alloc(readSize);
    const chunks: Buffer[] = [];
    let offset = 0;
    const handle = await new Promise<Buffer>((resolve, reject) =>
      s.open(path, "r", (e, h) => (e ? reject(sftpError(e, path)) : resolve(h))),
    );
    try {
      for (;;) {
        const bytesRead = await new Promise<number>((resolve, reject) =>
          s.read(handle, buffer, 0, readSize, offset, (e, b) =>
            e ? reject(sftpError(e, path)) : resolve(b),
          ),
        );
        if (bytesRead === 0) break;
        chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
        offset += bytesRead;
        if (offset > maxBytes) break;
      }
      const all = Buffer.concat(chunks);
      const truncated = all.length > maxBytes;
      const slice = truncated ? all.subarray(0, maxBytes) : all;
      return {
        text: looksUtf8(trimPartialRune(slice))
          ? slice.toString("utf8")
          : `[binary file, ${all.length} bytes] — inspect with run_command (file, hexdump -C | head)`,
        truncated,
      };
    } finally {
      s.close(handle, () => {});
    }
  }
}

async function writeAtomic(s: SFTPWrapper, path: string, content: string): Promise<void> {
  {
    // temp name then rename: a crash mid-write never leaves a half file.
    // Random suffix: pid+ms collide for concurrent writes.
    const tmp = `${path}.ta-tmp-${process.pid}-${cryptoRandomSuffix()}`;
    try {
      await new Promise<void>((resolve, reject) =>
        s.writeFile(tmp, Buffer.from(content, "utf8"), (e) =>
          e ? reject(sftpError(e, tmp)) : resolve(),
        ),
      );
      await new Promise<void>((resolve, reject) =>
        s.rename(tmp, path, (e) => (e ? reject(sftpError(e, path)) : resolve())),
      );
    } catch (error) {
      s.unlink(tmp, () => {});
      throw error;
    }
  }
}

function cryptoRandomSuffix(): string {
  return randomBytes(6).toString("hex");
}

/** Drop a trailing partial UTF-8 rune so a capped slice still validates as text. */
function trimPartialRune(buffer: Buffer): Buffer {
  for (let drop = 0; drop < 4 && buffer.length - drop > 0; drop++) {
    const last = buffer[buffer.length - 1 - drop];
    const need = last < 0x80 ? 0 : last < 0xe0 ? 1 : last < 0xf0 ? 2 : 3;
    if (need === 0) return buffer.subarray(0, buffer.length - drop);
    const start = buffer.length - 1 - drop - (need - 1);
    if (start >= 0 && buffer[start] >= 0xc0) return buffer.subarray(0, start);
  }
  return buffer;
}

/** ssh2 SFTP status codes → one readable line. */
function sftpError(error: unknown, path: string): Error {
  const code =
    error && typeof error === "object" && "code" in error ? Number(error.code) : undefined;
  if (code === 2) return new Error(`No such file: ${path}`);
  if (code === 3) return new Error(`Permission denied: ${path}`);
  return error instanceof Error ? error : new Error(String(error));
}

function collect(channel: ClientChannel, timeoutMs: number): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timer = setTimeout(() => {
      channel.close();
      reject(
        new Error(
          `Command timed out after ${Math.round(timeoutMs / 1000)}s. Rerun with detached:true if it must keep running.`,
        ),
      );
    }, timeoutMs);
    const cap = 60_000; // bytes kept before the char cap trims; excess dropped live
    let kept = 0;
    const push = (sink: Buffer[]) => (b: Buffer) => {
      kept += b.length;
      if (kept <= cap) sink.push(b);
    };
    channel.on("data", push(stdout));
    channel.stderr.on("data", push(stderr));
    channel.on("close", (code: number | null) => {
      clearTimeout(timer);
      const combined =
        Buffer.concat(stdout).toString("utf8") +
        (stderr.length ? `\n${Buffer.concat(stderr).toString("utf8")}` : "");
      const trimmed = combined.trimEnd();
      resolve({
        output: trimmed.length > 30_000 ? trimmed.slice(0, 30_000) + "\n… (truncated)" : trimmed,
        exitCode: code ?? 255,
      });
    });
    channel.on("error", (e: Error) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

function looksUtf8(buffer: Buffer): boolean {
  // Buffer.toString("utf8") replaces invalid sequences with U+FFFD; a clean
  // round-trip means the bytes are valid UTF-8.
  return !buffer.toString("utf8").includes("\uFFFD");
}
