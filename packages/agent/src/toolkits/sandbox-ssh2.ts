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
import { createHash } from "node:crypto";
import ssh2, { type ClientChannel, type ConnectConfig, type SFTPWrapper } from "ssh2";
const { Client } = ssh2;
type ClientClass = typeof Client;
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
        client.exec(command, (error, channel) => {
          if (error) return reject(error);
          collect(channel, options?.timeoutMs ?? 120_000).then(resolve, reject);
        });
      });
    },

    async readFile(path, options) {
      const s = await sftp();
      const maxBytes = options?.maxBytes ?? 200_000;
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
          text: looksUtf8(slice)
            ? slice.toString("utf8")
            : `[binary file, ${all.length} bytes] — inspect with run_command (file, hexdump -C | head)`,
          truncated,
        };
      } finally {
        s.close(handle, () => {});
      }
    },

    async writeFile(path, content) {
      const s = await sftp();
      // temp name then rename: a crash mid-write never leaves a half file
      const tmp = `${path}.ta-tmp-${process.pid}-${Date.now()}`;
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
    },

    close() {
      client.end();
    },
  };
}

/** ssh2 SFTP status codes → one readable line. */
function sftpError(error: unknown, path: string): Error {
  const code =
    error && typeof error === "object" && "code" in error ? Number(error.code) : undefined;
  if (code === 2 || code === 4) return new Error(`No such file: ${path}`);
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
    channel.on("data", (b: Buffer) => stdout.push(b));
    channel.stderr.on("data", (b: Buffer) => stderr.push(b));
    channel.on("close", (code: number | null) => {
      clearTimeout(timer);
      const combined =
        Buffer.concat(stdout).toString("utf8") +
        (stderr.length ? `\n${Buffer.concat(stderr).toString("utf8")}` : "");
      const trimmed = combined.trimEnd();
      resolve({
        output: trimmed.length > 30_000 ? trimmed.slice(0, 30_000) + "\n… (truncated)" : trimmed,
        exitCode: code ?? 0,
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
