import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  statSync,
  rmSync,
  type Stats,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { generateKeyPairSync } from "node:crypto";
import { EventEmitter } from "node:events";
import { connect } from "node:net";
import ssh2 from "ssh2";
const { Server: SshServer, Client: Ssh2Client } = ssh2;
type Connection = import("ssh2").Connection;
export { Ssh2Client };
export type { ClientChannel, ExecOptions } from "ssh2";
type SftpServerStream = import("ssh2").SFTPWrapper;
type Attributes = import("ssh2").Attributes;
interface PtyServerStream extends EventEmitter {
  setWindow(rows: number, cols: number, height?: number, width?: number): void;
  write(data: string | Buffer): boolean;
  end(): void;
  exit(code: number | null): void;
}

export interface FakeSandboxServer {
  port: number;
  root: string;
  execCalls: string[];
  connections: number;
  readonly open: number;
  forwards: number[];
  dropConnections(): void;
  close(): void;
}

export type ExecHandler = (command: string) =>
  | {
      stdout?: string;
      stderr?: string;
      exitCode?: number;
      echoStdin?: boolean;
      hang?: boolean;
      keepOpen?: boolean;
    }
  | null
  | "stall";

export interface PtyRequestInfo {
  term: string;
  cols: number;
  rows: number;
}

export type PtyHandler = null | ((command: string, info: PtyRequestInfo) => FakePty | null);

export function fakePty(command: string, info: PtyRequestInfo): FakePty {
  const p: BoundFakePty = {
    command,
    term: info.term,
    cols: info.cols,
    rows: info.rows,
    written: [],
    resizes: [],
    setWindow(cols, rows) {
      p.cols = cols;
      p.rows = rows;
    },
    emit(data) {
      p.serverStream?.write(data);
    },
    end() {
      p.serverStream?.exit(0);
      p.serverStream?.end();
    },
  };
  return p;
}

export interface FakePty {
  command: string;
  term: string;
  cols: number;
  rows: number;
  written: Buffer[];
  resizes: Array<{ cols: number; rows: number }>;
  setWindow(cols: number, rows: number): void;
  emit(data: string | Buffer): void;
  end(): void;
}

interface BoundFakePty extends FakePty {
  serverStream?: PtyServerStream;
}

export interface FakeSandboxServerOptions {
  authorizedKey?: string;
}

export function startFakeSandboxServer(
  exec: ExecHandler = () => ({ stdout: "" }),
  pty: PtyHandler = null,
  options: FakeSandboxServerOptions = {},
): Promise<FakeSandboxServer> {
  const allowed = options.authorizedKey ? ssh2.utils.parseKey(options.authorizedKey) : undefined;
  if (allowed instanceof Error) throw allowed;
  const root = mkdtempSync(join(tmpdir(), "ta-sandbox-test-"));
  const hostKey = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({
    format: "pem",
    type: "sec1",
  }) as unknown as string;
  const execCalls: string[] = [];
  const forwards: number[] = [];
  let connections = 0;
  let closed = false;
  const clients = new Set<Connection>();

  const server = new SshServer({ hostKeys: [hostKey] }, (client: Connection) => {
    clients.add(client);
    connections++;
    client.on("close", () => clients.delete(client));
    client.on("error", () => {});
    client.on("authentication", (ctx) => {
      if (!allowed) return ctx.method === "none" ? ctx.accept() : ctx.reject(["none"]);
      const matches =
        ctx.method === "publickey" &&
        ctx.key.algo === allowed.type &&
        ctx.key.data.equals(allowed.getPublicSSH());
      if (!matches) return ctx.reject(["publickey"]);
      if (ctx.signature && allowed.verify(ctx.blob!, ctx.signature, ctx.hashAlgo) !== true) {
        return ctx.reject(["publickey"]);
      }
      return ctx.accept();
    });
    client.on("session", (accept) => {
      const session = accept();
      let sessionPty: PtyRequestInfo | null = null;
      let boundPty: FakePty | null = null;
      session.on("pty", (acceptPty, reject, info: import("ssh2").PseudoTtyInfo) => {
        if (!pty) return reject();
        sessionPty = {
          term: info.term,
          cols: info.cols,
          rows: info.rows,
        };
        acceptPty();
      });
      session.on("window-change", (_accept, _reject, info: import("ssh2").WindowChangeInfo) => {
        if (!boundPty) return;
        boundPty.cols = info.cols;
        boundPty.rows = info.rows;
        boundPty.resizes.push({ cols: info.cols, rows: info.rows });
      });
      session.on("exec", (acceptExec, reject, info) => {
        execCalls.push(info.command);
        if (sessionPty && pty) {
          const fake = pty(info.command, sessionPty);
          if (!fake) return reject();
          const stream = acceptExec();
          const bound = fake as BoundFakePty;
          bound.serverStream = stream;
          boundPty = fake;
          stream.on("data", (data: Buffer) => fake.written.push(data));
          stream.once("close", () => {
            fake.end();
          });
          return;
        }
        let reply: ReturnType<ExecHandler>;
        try {
          reply = exec(info.command);
        } catch (error) {
          reply = { stderr: String(error), exitCode: 1 };
        }
        if (reply === null) return reject();
        if (reply === "stall") return;
        const stream = acceptExec();
        if (reply.hang) return;
        if (reply.echoStdin) {
          const input: Buffer[] = [];
          stream.on("data", (data: Buffer) => input.push(data));
          stream.once("end", () => {
            stream.write(Buffer.concat(input));
            stream.exit(0);
            stream.end();
          });
          return;
        }
        if (reply.stderr) stream.stderr.write(reply.stderr);
        if (reply.stdout) stream.write(reply.stdout);
        stream.exit(reply.exitCode ?? 0);
        if (!reply.keepOpen) stream.end();
      });
      session.on("sftp", (acceptSftp) => {
        handleSftp(acceptSftp(), root);
      });
    });
    client.on("tcpip", (accept, reject, info) => {
      forwards.push(info.destPort);
      const socket = connect(info.destPort, "127.0.0.1");
      socket.once("error", () => reject());
      socket.once("connect", () => {
        const channel = accept();
        socket.removeAllListeners("error");
        socket.on("error", () => channel.destroy());
        channel.on("error", () => socket.destroy());
        channel.pipe(socket).pipe(channel);
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
        get open() {
          return clients.size;
        },
        forwards,
        dropConnections: () => {
          for (const c of clients) c.end();
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

function safe(root: string, path: string): string | null {
  const resolved = join(root, path.replace(/^\/+/, ""));
  const rel = relative(root, resolved);
  return rel.startsWith("..") || rel === "" ? null : resolved;
}

const NO_ATTRIBUTES: Attributes = { mode: 0, uid: 0, gid: 0, size: 0, atime: 0, mtime: 0 };

function attributesOf(stat: Stats): Attributes {
  return {
    mode: stat.mode,
    uid: stat.uid,
    gid: stat.gid,
    size: stat.size,
    atime: Math.floor(stat.atimeMs / 1000),
    mtime: Math.floor(stat.mtimeMs / 1000),
  };
}

function handleSftp(sftp: SftpServerStream, root: string): void {
  const handles = new Map<number, { path: string }>();
  let nextHandle = 1;

  const status = (reqId: number, code = 0, message = "ok") => sftp.status(reqId, code, message);

  sftp.on("OPEN", (reqId, filename, flags) => {
    const path = safe(root, filename);
    if (!path) return status(reqId, 2, "no such file");
    if ((flags & 0x0000000e) !== 0) {
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
      sftp.attrs(reqId, attributesOf(stat));
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
    const filename = "/" + path.replace(/^\/+/, "");
    sftp.name(reqId, [{ filename, longname: filename, attrs: NO_ATTRIBUTES }]);
  });

  sftp.on("STAT", (reqId, path) => {
    const from = safe(root, path);
    if (!from) return status(reqId, 2, "no such file");
    try {
      sftp.attrs(reqId, attributesOf(statSync(from)));
    } catch {
      status(reqId, 2, "no such file");
    }
  });
}
