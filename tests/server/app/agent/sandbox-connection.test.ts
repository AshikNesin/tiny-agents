/**
 * The sandbox connection, once, at its interface: the real ssh2 client
 * against the in-process SSH server. One pooled connection for execs, ptys,
 * file transfers and forwards; the retry rule (a refusal is retried once on a
 * fresh connection, a stalled exec is not); a dropped connection retired and
 * redialed; the idle close; the tailscaled rule for closed forwards; TOFU
 * host keys; and the one "Cannot reach the sandbox" wording. The dial's own
 * guarantees (a late ssh2 error never crashes the process) use a fake ssh2
 * Client class, since a real server cannot provoke them on demand.
 */
import { EventEmitter } from "node:events";
import { createServer, type Server } from "node:net";
import type { Duplex } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  ChannelStallError,
  createMemoryHostKeyStore,
  dialSsh,
  ForwardRefusedError,
  HostKeyChangedError,
  hostKeyHash,
  SandboxTimeoutError,
  type SshEndpoint,
} from "../../../../packages/agent/src/ssh/connection";
import {
  createSandboxConnection,
  type SandboxConnection,
  type SandboxConnectionOptions,
} from "../../../../packages/agent/src/ssh/sandbox-connection";
import {
  fakePty,
  startFakeSandboxServer,
  type ExecHandler,
  type FakePty,
  type FakeSandboxServer,
} from "../../../../packages/agent/src/testing-ssh-server";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

/** Echo whatever follows `echo `; everything else answers empty. */
const echo: ExecHandler = (command) =>
  command.startsWith("echo ") ? { stdout: command.slice(5) } : { stdout: "" };

async function sandbox(
  handler: ExecHandler = echo,
  options: SandboxConnectionOptions & { endpoint?: Partial<SshEndpoint>; ptys?: FakePty[] } = {},
): Promise<{ server: FakeSandboxServer; connection: SandboxConnection }> {
  const ptys = options.ptys;
  const server = await startFakeSandboxServer(
    handler,
    ptys
      ? (command, info) => {
          const pty = fakePty(command, info);
          ptys.push(pty);
          return pty;
        }
      : null,
  );
  const connection = createSandboxConnection(
    { host: "127.0.0.1", port: server.port, ...options.endpoint },
    options,
  );
  cleanups.push(() => server.close());
  cleanups.push(() => connection.close());
  return { server, connection };
}

const text = (result: { stdout: Buffer }) => result.stdout.toString("utf8");

/** A TCP echo service standing in for a port on the sandbox's loopback. */
async function echoService(): Promise<{ port: number; server: Server }> {
  const server = createServer((socket) => socket.pipe(socket));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => server.close());
  return { port: (server.address() as { port: number }).port, server };
}

function roundTrip(stream: Duplex, message: string): Promise<string> {
  return new Promise((resolve, reject) => {
    stream.once("data", (data: Buffer) => resolve(data.toString("utf8")));
    stream.once("error", reject);
    stream.write(message);
  });
}

describe("sandbox connection: exec", () => {
  it("runs every call over one connection, concurrent first callers included", async () => {
    const { server, connection } = await sandbox();
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => connection.exec(`echo ${i}`)),
    );
    expect(results.map(text)).toEqual(["0", "1", "2", "3", "4"]);
    for (let i = 0; i < 3; i++) await connection.exec("echo again");
    expect(server.connections).toBe(1);
  });

  it("keeps stdout, stderr and the exit status apart", async () => {
    const { connection } = await sandbox(() => ({ stdout: "out", stderr: "err", exitCode: 3 }));
    expect(await connection.exec("anything")).toEqual({
      stdout: Buffer.from("out"),
      stderr: "err",
      exitCode: 3,
      truncated: false,
    });
  });

  it("writes stdin and closes it, so a secret never rides on the command line", async () => {
    const { server, connection } = await sandbox(() => ({ echoStdin: true }));
    const result = await connection.exec("read-secret", { stdin: "s3cret\n" });
    expect(text(result)).toBe("s3cret\n");
    expect(server.execCalls).toEqual(["read-secret"]);
  });

  it("keeps maxBytes of output and says it dropped the rest", async () => {
    const { connection } = await sandbox(() => ({ stdout: "x".repeat(1000) }));
    const result = await connection.exec("big", { maxBytes: 100 });
    expect(result.stdout).toHaveLength(100);
    expect(result.truncated).toBe(true);
  });

  it("closes a command that runs past its timeout, and the connection stays up", async () => {
    const { server, connection } = await sandbox((command) =>
      command === "forever" ? { hang: true } : echo(command),
    );
    await expect(connection.exec("forever", { timeoutMs: 100 })).rejects.toBeInstanceOf(
      SandboxTimeoutError,
    );
    expect(text(await connection.exec("echo still here"))).toBe("still here");
    expect(server.connections).toBe(1);
  });

  it("settles after exit when a child holds the channel open, if asked to", async () => {
    const { connection } = await sandbox(() => ({ stdout: "launched", keepOpen: true }));
    const result = await connection.exec("start-app", { settleOnExit: true, timeoutMs: 2000 });
    expect(text(result)).toBe("launched");
    await expect(connection.exec("start-app", { timeoutMs: 200 })).rejects.toBeInstanceOf(
      SandboxTimeoutError,
    );
  });
});

describe("sandbox connection: the retry rule", () => {
  it("retries a refused channel once on a fresh connection", async () => {
    let refuse = 1;
    const { server, connection } = await sandbox((command) =>
      refuse-- > 0 ? null : echo(command),
    );
    await connection.exec("echo warm").catch(() => {}); // refused, then retried
    expect(server.connections).toBe(2);
    expect(text(await connection.exec("echo after"))).toBe("after");
    expect(server.connections).toBe(2);
  });

  it("surfaces a refusal that happens again on the fresh connection", async () => {
    const { server, connection } = await sandbox(() => null);
    await expect(connection.exec("refused")).rejects.toThrow(/Unable to exec|denied|failure/i);
    expect(server.execCalls).toEqual(["refused", "refused"]);
  });

  it("never re-runs an exec whose open stalled: it might have run", async () => {
    const { server, connection } = await sandbox(
      (command) => (command === "stall" ? "stall" : echo(command)),
      { channelOpenTimeoutMs: 500 },
    );
    await connection.exec("echo warm");
    await expect(connection.exec("stall")).rejects.toBeInstanceOf(ChannelStallError);
    expect(server.execCalls).toEqual(["echo warm", "stall"]);
    // The stalled connection is retired: the next call dials a fresh one.
    expect(text(await connection.exec("echo fresh"))).toBe("fresh");
    expect(server.connections).toBe(2);
  });

  it("retires a dropped connection and redials on the next call", async () => {
    const { server, connection } = await sandbox();
    await connection.exec("echo one");
    server.dropConnections();
    await vi.waitFor(() => expect(server.open).toBe(0));
    expect(text(await connection.exec("echo two"))).toBe("two");
    expect(server.connections).toBe(2);
  });

  it("words an unreachable sandbox once, and redials once before giving up", async () => {
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
    const port = (closed.address() as { port: number }).port;
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    const connection = createSandboxConnection({ host: "127.0.0.1", port });
    cleanups.push(() => connection.close());
    await expect(connection.exec("ls")).rejects.toThrow(
      `Cannot reach the sandbox (connect ECONNREFUSED 127.0.0.1:${port}). Is it online and on the tailnet?`,
    );
  });
});

describe("sandbox connection: ptys, files and forwards share the connection", () => {
  it("keeps the connection while a pty is open, and closes only the pty's channel", async () => {
    const ptys: FakePty[] = [];
    const { server, connection } = await sandbox(echo, { ptys, idleTimeoutMs: 50 });
    const first = await connection.pty("attach 1", { term: "xterm-256color", cols: 80, rows: 24 });
    const second = await connection.pty("attach 2", { term: "xterm-256color", cols: 80, rows: 24 });
    expect(ptys.map((p) => [p.command, p.cols, p.rows])).toEqual([
      ["attach 1", 80, 24],
      ["attach 2", 80, 24],
    ]);
    first.destroy();
    await new Promise((resolve) => setTimeout(resolve, 120)); // past the idle timeout
    expect(text(await connection.exec("echo while attached"))).toBe("while attached");
    expect(server.connections).toBe(1);

    second.setWindow(40, 120);
    second.write("ls\r");
    await vi.waitFor(() => expect(ptys[1]!.resizes).toEqual([{ cols: 120, rows: 40 }]));
    await vi.waitFor(() => expect(Buffer.concat(ptys[1]!.written).toString()).toBe("ls\r"));
    const output = new Promise((resolve) => second.once("data", (d: Buffer) => resolve(String(d))));
    ptys[1]!.emit("hello");
    expect(await output).toBe("hello");

    // The program exits: the stream ends, then the idle close ends the connection.
    second.resume();
    ptys[1]!.end();
    expect(await second.done).toEqual({ exitCode: 0 });
    await vi.waitFor(() => expect(server.open).toBe(0));
    expect(server.connections).toBe(1);
  });

  it("writes atomically and reads back over SFTP on the same connection", async () => {
    const { server, connection } = await sandbox();
    const payload = "line one\nline two — ünïcödé ✓\n";
    await connection.writeFile("/notes.txt", payload);
    await connection.writeFile("/notes.txt", payload); // overwrite: temp name, then rename
    const file = await connection.readFile("/notes.txt");
    expect(file.bytes.toString("utf8")).toBe(payload);
    expect(file.truncated).toBe(false);
    const capped = await connection.readFile("/notes.txt", { maxBytes: 4 });
    expect(capped).toMatchObject({ bytes: Buffer.from("line"), truncated: true });
    await expect(connection.readFile("/nope.txt")).rejects.toThrow("No such file: /nope.txt");
    expect(server.connections).toBe(1);
  });

  it("forwards to a port on the sandbox both ways, beside execs", async () => {
    const service = await echoService();
    const { server, connection } = await sandbox();
    const tunnel = await connection.forward(service.port);
    expect(await roundTrip(tunnel, "through the tunnel")).toBe("through the tunnel");
    expect(text(await connection.exec("echo beside it"))).toBe("beside it");
    expect(server.forwards).toEqual([service.port]);
    expect(server.connections).toBe(1);
    tunnel.destroy();
  });

  it("refuses a forward to a closed port without retiring the connection", async () => {
    const service = await echoService();
    const { port } = service;
    await new Promise<void>((resolve) => service.server.close(() => resolve()));
    const { server, connection } = await sandbox();
    await connection.exec("echo warm");
    await expect(connection.forward(port)).rejects.toBeInstanceOf(ForwardRefusedError);
    expect(text(await connection.exec("echo same"))).toBe("same");
    expect(server.connections).toBe(1);
  });

  it("retires a connection once a forward on it closes, leaving its other channels alone", async () => {
    const service = await echoService();
    const ptys: FakePty[] = [];
    const { server, connection } = await sandbox(echo, { ptys });
    const pty = await connection.pty("attach", { term: "xterm-256color", cols: 80, rows: 24 });
    const tunnel = await connection.forward(service.port);
    await roundTrip(tunnel, "ping");
    const closed = new Promise((resolve) => tunnel.once("close", resolve));
    tunnel.destroy();
    await closed;

    // New channels go to a fresh connection (tailscaled stalls them on the old one)…
    expect(text(await connection.exec("echo next"))).toBe("next");
    expect(server.connections).toBe(2);
    // …and the pty on the retired one carries on until it closes.
    const output = new Promise((resolve) => pty.once("data", (d: Buffer) => resolve(String(d))));
    ptys[0]!.emit("still attached");
    expect(await output).toBe("still attached");
    pty.destroy();
    await vi.waitFor(() => expect(server.open).toBe(1));
  });
});

describe("sandbox connection: idle close and close", () => {
  it("ends the connection after the idle timeout and redials on the next call", async () => {
    const { server, connection } = await sandbox(echo, { idleTimeoutMs: 30 });
    await connection.exec("echo one");
    expect(server.open).toBe(1);
    await vi.waitFor(() => expect(server.open).toBe(0));
    await connection.exec("echo two");
    expect(server.connections).toBe(2);
  });

  it("ends every connection on close, and refuses calls after it", async () => {
    const { server, connection } = await sandbox();
    await connection.exec("echo one");
    connection.close();
    await vi.waitFor(() => expect(server.open).toBe(0));
    await expect(connection.exec("echo two")).rejects.toThrow("closed");
  });
});

describe("sandbox connection: TOFU host keys", () => {
  it("pins the key on first connect, keeps it, and refuses a changed one without retrying", async () => {
    const hostKeys = createMemoryHostKeyStore();
    const { connection } = await sandbox(echo, { endpoint: { hostKeys } });
    await connection.exec("echo one");
    const pinned = await hostKeys.get("127.0.0.1");
    expect(pinned).toMatch(/^sha256:/);
    connection.close();

    // Another server on the same host presents a different key.
    const { server: other, connection: intercepted } = await sandbox(echo, {
      endpoint: { hostKeys },
    });
    await expect(intercepted.exec("echo two")).rejects.toBeInstanceOf(HostKeyChangedError);
    await expect(intercepted.exec("echo two")).rejects.toThrow(/host key changed/);
    expect(await hostKeys.get("127.0.0.1")).toBe(pinned);
    expect(other.execCalls).toEqual([]);
  });
});

type ConnectConfig = {
  host: string;
  privateKey?: string;
  hostVerifier?: (key: Buffer, verify: (ok: boolean) => void) => void;
};

/** A fake ssh2 Client class whose handshake the test drives by hand. */
function fakeSsh2(key = Buffer.from("host-key-A")) {
  const clients: FakeClient[] = [];
  class FakeClient extends EventEmitter {
    config!: ConnectConfig;
    ended = false;
    constructor() {
      super();
      clients.push(this);
    }
    connect(config: ConnectConfig): this {
      this.config = config;
      queueMicrotask(() => {
        if (!config.hostVerifier) {
          this.emit("ready");
          return;
        }
        config.hostVerifier(key, (ok) => {
          if (ok) this.emit("ready");
          else this.emit("error", new Error("Host key rejected"));
        });
      });
      return this;
    }
    end(): void {
      this.ended = true;
    }
  }
  return { Client: FakeClient as never, clients };
}

describe("the dial", () => {
  it("keeps handling errors after ready, so a late ssh2 error cannot crash the process", async () => {
    const ssh = fakeSsh2();
    const client = await dialSsh({ host: "vm" }, ssh.Client);
    // An EventEmitter with no 'error' listener throws here; ours must not.
    expect(() => client.emit("error", new Error("Connection lost"))).not.toThrow();
    expect(() => client.emit("error", new Error("Connection lost again"))).not.toThrow();
  });

  it("dials keyless (Tailscale SSH) by default and with public-key auth when given a key", async () => {
    const ssh = fakeSsh2();
    await dialSsh({ host: "tiny-agents-vm" }, ssh.Client);
    expect(ssh.clients[0]!.config).not.toHaveProperty("privateKey");
    await dialSsh({ host: "127.0.0.1", port: 2222, privateKey: "KEY" }, ssh.Client);
    expect(ssh.clients[1]!.config.privateKey).toBe("KEY");
  });

  it("rejects once on a failed handshake and swallows the second error", async () => {
    const ssh = fakeSsh2();
    class Failing extends (ssh.Client as new () => EventEmitter & {
      end(): void;
      ended: boolean;
    }) {
      connect(): this {
        queueMicrotask(() => {
          this.emit("error", new Error("Timed out while waiting for handshake"));
          this.emit("close");
          this.emit("error", new Error("Connection lost before handshake"));
        });
        return this;
      }
    }
    await expect(dialSsh({ host: "vm" }, Failing as never)).rejects.toThrow("handshake");
    expect(ssh.clients[0]!.ended).toBe(true);
  });

  it("ends the client when the host key changed", async () => {
    const hostKeys = createMemoryHostKeyStore();
    await hostKeys.set("vm", hostKeyHash(Buffer.from("host-key-A")));
    const changed = fakeSsh2(Buffer.from("host-key-B"));
    await expect(dialSsh({ host: "vm", hostKeys }, changed.Client)).rejects.toThrow(
      /host key changed/,
    );
    expect(changed.clients[0]!.ended).toBe(true);
  });
});
