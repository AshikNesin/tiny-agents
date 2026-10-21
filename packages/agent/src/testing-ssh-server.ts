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
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { generateKeyPairSync } from "node:crypto";
import { EventEmitter } from "node:events";
import ssh2 from "ssh2";
// default-interop: a plain-node child (durability tests) can't resolve ssh2's
// named exports through cjs-module-lexer, but the default export works everywhere
const { Server: SshServer } = ssh2;
type Connection = import("ssh2").Connection;
// The server-side exec stream lives in ssh2's runtime but not its types; a
// FakePty needs the reverse direction wired onto it.
type SftpServerStream = EventEmitter & Record<string, any>;
interface PtyServerStream extends EventEmitter {
  setWindow(rows: number, cols: number, height?: number, width?: number): void;
  write(data: string | Buffer): boolean;
  end(): void;
}

export interface FakeSandboxServer {
  port: number;
  root: string;
  /** Every command the server has been asked to run, in order. */
  execCalls: string[];
  /** Completed SSH handshakes: makes fresh-connection invariants observable. */
  connections: number;
  close(): void;
}

/** What the test wants each command to answer. */
export type ExecHandler = (command: string) => {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
};

/** Attach metadata the server sees when a pty is requested on exec. */
export interface PtyRequestInfo {
  term: string;
  cols: number;
  rows: number;
}

/** Interactivity handler: `null` (default) rejects pty requests; tests opt in. */
export type PtyHandler = null | ((command: string, info: PtyRequestInfo) => FakePty | null);

/**
 * Build a FakePty a test returns from its PtyHandler. The ssh2 stream is
 * bound after the handler answers, so the methods below act on it lazily;
 * `emit` before binding drops the bytes (nothing is listening yet).
 */
export function fakePty(command: string, info: PtyRequestInfo): FakePty {
  const p: BoundFakePty = {
    command,
    term: info.term,
    cols: info.cols,
    rows: info.rows,
    written: [],
    setWindow(cols, rows) {
      p.cols = cols;
      p.rows = rows;
      p.serverStream?.setWindow(rows, cols);
    },
    emit(data) {
      p.serverStream?.write(data);
    },
    end() {
      p.serverStream?.end();
    },
  };
  return p;
}

/**
 * The pty shape a terminal test needs: a command stream the handler keeps
 * open, echoes bytes back from, and can set the window size on. Recording
 * the requested pty (term/cols/rows) lets tests assert the attach asked for
 * the right terminal geometry.
 */
export interface FakePty {
  command: string;
  term: string;
  cols: number;
  rows: number;
  /** Bytes the client sent into the pty, in order. */
  written: Buffer[];
  setWindow(cols: number, rows: number): void;
  /** Push output to the client as if the remote program had printed it. */
  emit(data: string | Buffer): void;
  /** End the stream from the server side, like the remote program exiting. */
  end(): void;
}

/** The ssh2 exec stream a FakePty is bound to, hidden from tests. */
interface BoundFakePty extends FakePty {
  serverStream?: PtyServerStream;
}

export function startFakeSandboxServer(
  exec: ExecHandler = () => ({ stdout: "" }),
  pty: PtyHandler = null,
): Promise<FakeSandboxServer> {
  const root = mkdtempSync(join(tmpdir(), "ta-sandbox-test-"));
  // ssh2 1.17 cannot parse ed25519 pkcs8; EC P-256 in sec1 parses fine.
  const hostKey = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({
    format: "pem",
    type: "sec1",
  }) as unknown as string;
  const execCalls: string[] = [];
  let connections = 0;
  let closed = false;
  const clients = new Set<Connection>();

  const server = new SshServer({ hostKeys: [hostKey] }, (client: Connection) => {
    clients.add(client);
    connections++;
    client.on("close", () => clients.delete(client));
    // Tailscale-style: only `none` auth. A client that starts sending
    // credentials is not the shape this fixture simulates — reject it.
    client.on("authentication", (ctx) =>
      ctx.method === "none" ? ctx.accept() : ctx.reject(["none"]),
    );
    client.on("session", (accept) => {
      const session = accept();
      let sessionPty: PtyRequestInfo | null = null;
      // A pty attach (terminal feature) is interactive: the pty request
      // arrives as its own event before exec, and the exec stream only
      // becomes readable once both are accepted. Without a pty handler the
      // request is rejected, matching a pre-pty server.
      session.on("pty", (acceptPty, reject, info: import("ssh2").PseudoTtyInfo) => {
        if (!pty) return reject();
        sessionPty = {
          term: info.term,
          cols: info.cols,
          rows: info.rows,
        };
        acceptPty();
      });
      session.on("exec", (acceptExec, reject, info) => {
        execCalls.push(info.command);
        if (sessionPty && pty) {
          const fake = pty(info.command, sessionPty);
          if (!fake) return reject();
          const stream = acceptExec();
          const bound = fake as BoundFakePty;
          bound.serverStream = stream;
          stream.on("data", (data: Buffer) => fake.written.push(data));
          stream.once("close", () => fake.end());
          return;
        }
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
        get connections() {
          return connections;
        },
        close: () => {
          if (closed) return;
          closed = true;
          for (const c of clients) c.end();
          clients.clear();
          server.close();
          rmSync(root, { recursive: true, force: true });
        },
      });
    });
  });
}

/** Path safety: resolve inside root, refuse escapes (prefix match is not enough). */
function safe(root: string, path: string): string | null {
  const resolved = join(root, path.replace(/^\/+/, ""));
  const rel = relative(root, resolved);
  return rel.startsWith("..") || rel === "" ? null : resolved;
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
