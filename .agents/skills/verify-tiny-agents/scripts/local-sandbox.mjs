#!/usr/bin/env node
/**
 * `ta-verify up --local-sandbox`: a sandbox without Docker. An SSH server on
 * 127.0.0.1 that runs what the app asks for on THIS machine: `exec` in a real
 * bash, a pty (so Terminal's tmux attach is a real shell, resize included) and
 * the SFTP subset the app's file reads and writes use. Any login is accepted,
 * so it listens on loopback only and belongs to a verify run, never a deploy.
 *
 * Usage: local-sandbox.mjs <port> <home>
 * Everything runs with HOME=<home>, so clones and tmux state stay in the run.
 */
import { spawn } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const { Server } = createRequire(path.join(REPO, "package.json"))("ssh2");

const port = Number(process.argv[2]);
const home = process.argv[3];
if (!port || !home) {
  console.error("usage: local-sandbox.mjs <port> <home>");
  process.exit(2);
}
fs.mkdirSync(home, { recursive: true });
const env = { ...process.env, HOME: home, TMUX_TMPDIR: home };

// A pty for one command: python's pty.fork, bytes relayed over stdin/stdout,
// and "rows cols" lines on fd 3 applied with TIOCSWINSZ so a resize reaches tmux.
const PTY_RELAY = `
import os, pty, sys, select, fcntl, termios, struct
cmd, rows, cols = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
pid, fd = pty.fork()
if pid == 0:
    os.execvp("bash", ["bash", "-lc", cmd])
def size(r, c):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", r, c, 0, 0))
size(rows, cols)
watch = [0, fd, 3]
while True:
    ready, _, _ = select.select(watch, [], [])
    if fd in ready:
        try:
            data = os.read(fd, 65536)
        except OSError:
            break
        if not data:
            break
        os.write(1, data)
    if 0 in ready:
        data = os.read(0, 65536)
        if not data:
            watch.remove(0)
        else:
            os.write(fd, data)
    if 3 in ready:
        data = os.read(3, 256)
        if not data:
            watch.remove(3)
        else:
            parts = data.split()
            size(int(parts[-2]), int(parts[-1]))
_, status = os.waitpid(pid, 0)
sys.exit(os.waitstatus_to_exitcode(status))
`;

function runExec(stream, command, ptyInfo, onResize) {
  const child = ptyInfo
    ? spawn(
        "python3",
        ["-c", PTY_RELAY, command, String(ptyInfo.rows || 24), String(ptyInfo.cols || 80)],
        {
          cwd: home,
          env: { ...env, TERM: ptyInfo.term || "xterm-256color" },
          stdio: ["pipe", "pipe", "pipe", "pipe"],
        },
      )
    : spawn("bash", ["-c", command], { cwd: home, env, stdio: ["pipe", "pipe", "pipe"] });
  if (ptyInfo) onResize((rows, cols) => child.stdio[3].write(`${rows} ${cols}\n`));
  child.stdin.on("error", () => {});
  stream.on("data", (data) => child.stdin.write(data));
  stream.on("end", () => child.stdin.end());
  stream.on("close", () => child.kill("SIGHUP"));
  child.stdout.on("data", (data) => stream.write(data));
  child.stderr.on("data", (data) => stream.stderr.write(data));
  child.on("error", (error) => {
    stream.stderr.write(String(error));
    stream.exit(127);
    stream.end();
  });
  child.on("close", (code) => {
    stream.exit(code ?? 0);
    stream.end();
  });
}

const attrsOf = (stat) => ({
  mode: stat.mode,
  uid: stat.uid,
  gid: stat.gid,
  size: stat.size,
  atime: Math.floor(stat.atimeMs / 1000),
  mtime: Math.floor(stat.mtimeMs / 1000),
});
const resolveHome = (file) => (path.isAbsolute(file) ? file : path.join(home, file));

function serveSftp(sftp) {
  const handles = new Map();
  let next = 1;
  const fail = (reqId, error) =>
    sftp.status(reqId, error?.code === "ENOENT" ? 2 : 3, String(error?.message ?? error));
  const guarded =
    (handler) =>
    (reqId, ...args) => {
      try {
        handler(reqId, ...args);
      } catch (error) {
        fail(reqId, error);
      }
    };
  sftp.on(
    "OPEN",
    guarded((reqId, filename, flags) => {
      const writing = (flags & 0x0e) !== 0;
      const fd = fs.openSync(resolveHome(filename), writing ? "w" : "r");
      const handle = Buffer.alloc(4);
      handle.writeUInt32BE(next);
      handles.set(next++, fd);
      sftp.handle(reqId, handle);
    }),
  );
  sftp.on(
    "READ",
    guarded((reqId, handle, offset, length) => {
      const buffer = Buffer.alloc(length);
      const read = fs.readSync(handles.get(handle.readUInt32BE()), buffer, 0, length, offset);
      if (read === 0) return sftp.status(reqId, 1, "eof");
      sftp.data(reqId, buffer.subarray(0, read));
    }),
  );
  sftp.on(
    "WRITE",
    guarded((reqId, handle, offset, data) => {
      fs.writeSync(handles.get(handle.readUInt32BE()), data, 0, data.length, offset);
      sftp.status(reqId, 0);
    }),
  );
  sftp.on(
    "FSTAT",
    guarded((reqId, handle) =>
      sftp.attrs(reqId, attrsOf(fs.fstatSync(handles.get(handle.readUInt32BE())))),
    ),
  );
  sftp.on(
    "CLOSE",
    guarded((reqId, handle) => {
      const id = handle.readUInt32BE();
      fs.closeSync(handles.get(id));
      handles.delete(id);
      sftp.status(reqId, 0);
    }),
  );
  sftp.on(
    "RENAME",
    guarded((reqId, from, to) => {
      fs.renameSync(resolveHome(from), resolveHome(to));
      sftp.status(reqId, 0);
    }),
  );
  sftp.on(
    "REMOVE",
    guarded((reqId, file) => {
      fs.unlinkSync(resolveHome(file));
      sftp.status(reqId, 0);
    }),
  );
  sftp.on(
    "REALPATH",
    guarded((reqId, file) => {
      const filename = resolveHome(file);
      sftp.name(reqId, [{ filename, longname: filename, attrs: {} }]);
    }),
  );
  for (const event of ["STAT", "LSTAT"]) {
    sftp.on(
      event,
      guarded((reqId, file) => sftp.attrs(reqId, attrsOf(fs.statSync(resolveHome(file))))),
    );
  }
}

const hostKey = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({
  format: "pem",
  type: "sec1",
});

new Server({ hostKeys: [hostKey] }, (client) => {
  client.on("error", () => {});
  client.on("authentication", (ctx) => ctx.accept());
  client.on("session", (accept) => {
    const session = accept();
    let ptyInfo = null;
    let resize = null;
    session.on("pty", (ok, _reject, info) => {
      ptyInfo = info;
      ok();
    });
    session.on("env", (ok) => ok?.());
    session.on("window-change", (ok, _reject, info) => {
      resize?.(info.rows, info.cols);
      ok?.();
    });
    session.on("exec", (acceptExec, _reject, info) =>
      runExec(acceptExec(), info.command, ptyInfo, (apply) => (resize = apply)),
    );
    session.on("shell", (acceptShell) =>
      runExec(acceptShell(), "exec bash -l", ptyInfo ?? { rows: 24, cols: 80 }, (apply) => {
        resize = apply;
      }),
    );
    session.on("sftp", (acceptSftp) => serveSftp(acceptSftp()));
  });
  client.on("tcpip", (_accept, reject) => reject());
}).listen(port, "127.0.0.1", () => console.log(`[local-sandbox] 127.0.0.1:${port} home=${home}`));
