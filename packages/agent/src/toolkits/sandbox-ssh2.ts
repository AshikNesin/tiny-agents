/**
 * The ssh2 binding behind the sandbox toolkit: an adapter over the shared
 * SSH connection module (`../ssh/connection`) that turns a dialed client
 * into the narrow `SandboxSession` the tools need (exec, readFile,
 * writeFile), so the toolkit never touches ssh2 types directly.
 */
import { randomBytes } from "node:crypto";
import type ssh2 from "ssh2";
import type { ClientChannel, SFTPWrapper } from "ssh2";
import { dialSsh, PreDispatchError, type SshClientClass } from "../ssh/connection";
import type { ExecResult, SandboxSession, SandboxTransport } from "./sandbox";

export type {
  ConnectOptions,
  ExecOptions,
  ExecResult,
  SandboxSession,
  SandboxTransport,
} from "./sandbox";
export { createMemoryHostKeyStore, PreDispatchError, type HostKeyStore } from "../ssh/connection";

/**
 * The production transport: one dialed client per session (`none` auth,
 * keepalive, TOFU host-key check against the endpoint's store).
 */
export function createSsh2Transport(ClientClass?: SshClientClass): SandboxTransport {
  return async (options) => createSession(await dialSsh(options, ClientClass));
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
          // Secrets for a confined command arrive here, never in the command line.
          if (options?.stdin !== undefined) channel.end(options.stdin);
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

async function writeAtomic(
  s: SFTPWrapper,
  path: string,
  content: string | Uint8Array,
): Promise<void> {
  // temp name then rename: a crash mid-write never leaves a half file.
  // Random suffix: pid+ms collide for concurrent writes.
  const tmp = `${path}.ta-tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
  try {
    await new Promise<void>((resolve, reject) =>
      s.writeFile(
        tmp,
        typeof content === "string" ? Buffer.from(content, "utf8") : Buffer.from(content),
        (e) => (e ? reject(sftpError(e, tmp)) : resolve()),
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
  return !buffer.toString("utf8").includes("�");
}
