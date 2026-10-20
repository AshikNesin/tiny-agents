/**
 * An in-process SSH server for tests (issue #19): ssh2's server mode with
 * `none` auth (the way Tailscale SSH presents it), canned exec handlers and
 * a real SFTP subsystem backed by a tmpdir. Integration tests drive the
 * production ssh2 client through it — same wire protocol, no network, no VM.
 */
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync } from "node:crypto";
import { EventEmitter } from "node:events";
import ssh2 from "ssh2";
// default-interop: a plain-node child (durability tests) can't resolve ssh2's
// named exports through cjs-module-lexer, but the default export works everywhere
const { Server: SshServer } = ssh2;
type Connection = import("ssh2").Connection;
// The server-side SFTP stream lives in ssh2's runtime but not its types.
type SftpServerStream = EventEmitter & Record<string, any>;

export interface FakeSandboxServer {
  port: number;
  root: string;
  /** Every command the server has been asked to run, in order. */
  execCalls: string[];
  close(): void;
}

/** What the test wants each command to answer. */
export type ExecHandler = (command: string) => {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
};

export function startFakeSandboxServer(
  exec: ExecHandler = () => ({ stdout: "" }),
): Promise<FakeSandboxServer> {
  const root = mkdtempSync(join(tmpdir(), "ta-sandbox-test-"));
  // ssh2 1.17 cannot parse ed25519 pkcs8; EC P-256 in sec1 parses fine.
  const hostKey = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({
    format: "pem",
    type: "sec1",
  }) as unknown as string;
  const execCalls: string[] = [];
  let closed = false;

  const server = new SshServer({ hostKeys: [hostKey] }, (client: Connection) => {
    client.on("authentication", (ctx) => ctx.accept());
    client.on("session", (accept) => {
      const session = accept();
      session.on("exec", (acceptExec, reject, info) => {
        execCalls.push(info.command);
        let reply: ReturnType<ExecHandler>;
        try {
          reply = exec(info.command);
        } catch (error) {
          reply = { stderr: String(error), exitCode: 1 };
        }
        if (reply === null) return reject();
        const stream = acceptExec();
        if (reply.stderr) stream.stderr.write(reply.stderr);
        if (reply.stdout) stream.write(reply.stdout);
        stream.exit(reply.exitCode ?? 0);
        stream.end();
      });
      session.on("sftp", (acceptSftp) => {
        handleSftp(acceptSftp() as unknown as SftpServerStream, root);
      });
    });
  });

  return new Promise((resolve) => {
    server.on("error", () => {});
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      resolve({
        port,
        root,
        execCalls,
        close: () => {
          if (!closed) {
            closed = true;
            server.close();
          }
        },
      });
    });
  });
}

/** Path safety: resolve inside root, refuse escapes. */
function safe(root: string, path: string): string | null {
  const resolved = join(root, path.replace(/^\/+/, ""));
  return resolved.startsWith(root) ? resolved : null;
}

function handleSftp(sftp: SftpServerStream, root: string): void {
  // handle → { path, fd } map; handles are opaque buffers
  const handles = new Map<number, { path: string }>();
  let nextHandle = 1;

  const status = (reqId: number, code = 0, message = "ok") => sftp.status(reqId, code, message);

  sftp.on("OPEN", (reqId, filename, flags) => {
    const path = safe(root, filename);
    if (!path) return status(reqId, 2, "no such file");
    if ((flags & 0x0000000e) !== 0) {
      // truncate-on-open (the client's writeFile opens with TRUNC)
      try {
        writeFileSync(path, Buffer.alloc(0));
      } catch {
        return status(reqId, 3, "cannot create");
      }
    }
    const handle = nextHandle++;
    handles.set(handle, { path });
    sftp.handle(reqId, Buffer.from([handle]));
  });

  sftp.on("READ", (reqId, handle, offset, len) => {
    const entry = handles.get(handle[0]);
    if (!entry) return status(reqId, 2, "no such file");
    let data: Buffer;
    try {
      data = readFileSync(entry.path);
    } catch {
      return status(reqId, 2, "no such file");
    }
    if (offset >= data.length) return status(reqId, 1, "eof");
    sftp.data(reqId, data.subarray(offset, offset + len));
  });

  sftp.on("WRITE", (reqId, handle, offset, data) => {
    const entry = handles.get(handle[0]);
    if (!entry) return status(reqId, 2, "no such file");
    try {
      const existing = readFileSync(entry.path).subarray(0, offset);
      writeFileSync(entry.path, Buffer.concat([existing, data]));
      status(reqId);
    } catch (error) {
      status(reqId, 3, String(error));
    }
  });

  sftp.on("FSTAT", (reqId, handle) => {
    const entry = handles.get(handle[0]);
    if (!entry) return status(reqId, 2, "no such file");
    try {
      const stat = statSync(entry.path);
      sftp.attrs(reqId, stat);
    } catch {
      status(reqId, 2, "no such file");
    }
  });

  sftp.on("CLOSE", (reqId, handle) => {
    handles.delete(handle[0]);
    status(reqId);
  });

  sftp.on("RENAME", (reqId, oldPath, newPath) => {
    const from = safe(root, oldPath);
    const to = safe(root, newPath);
    if (!from || !to) return status(reqId, 2, "no such file");
    try {
      renameSync(from, to);
      status(reqId);
    } catch (error) {
      status(reqId, 3, String(error));
    }
  });

  sftp.on("REMOVE", (reqId, path) => {
    const from = safe(root, path);
    if (!from) return status(reqId, 2, "no such file");
    try {
      unlinkSync(from);
      status(reqId);
    } catch {
      status(reqId, 2, "no such file");
    }
  });

  sftp.on("REALPATH", (reqId, path) => {
    sftp.name(reqId, ["/" + path.replace(/^\/+/, "")]);
  });

  sftp.on("STAT", (reqId, path) => {
    const from = safe(root, path);
    if (!from) return status(reqId, 2, "no such file");
    try {
      sftp.attrs(reqId, statSync(from));
    } catch {
      status(reqId, 2, "no such file");
    }
  });
}
