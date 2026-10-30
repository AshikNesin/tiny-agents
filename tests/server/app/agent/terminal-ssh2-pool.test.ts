/**
 * The terminal transport's connection pool (issue #84), against a fake ssh2
 * Client class: no sockets, every dial and channel observable. Covers one
 * dial for many execs, redial after the connection closes, the idle close,
 * and a pty's close leaving the shared connection up.
 */
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vite-plus/test";
import { createSsh2TerminalTransport } from "../../../../packages/agent/src/terminal/terminal-ssh2";

type ClientClass = NonNullable<Parameters<typeof createSsh2TerminalTransport>[1]>;
type ExecCallback = (error: Error | undefined, channel?: FakeChannel) => void;

class FakeChannel extends EventEmitter {
  readonly stderr = new EventEmitter();
  closed = false;
  readonly written: Buffer[] = [];
  readonly setWindow = vi.fn();

  constructor(
    readonly command: string,
    readonly pty: boolean,
  ) {
    super();
  }

  write(chunk: Buffer): boolean {
    this.written.push(chunk);
    return true;
  }

  resume(): void {}

  close(): void {
    this.finish(null);
  }

  finish(code: number | null): void {
    if (this.closed) return;
    this.closed = true;
    this.emit("close", code);
  }
}

/** A fresh fake Client class per test, recording every instance it makes. */
function fakeSsh2() {
  const clients: FakeClient[] = [];
  const control = { refuseNext: 0 };

  class FakeClient extends EventEmitter {
    readonly channels: FakeChannel[] = [];
    ended = false;

    constructor() {
      super();
      clients.push(this);
    }

    connect(): this {
      queueMicrotask(() => this.emit("ready"));
      return this;
    }

    exec(command: string, options: unknown, cb?: ExecCallback): void {
      const callback = (typeof options === "function" ? options : cb) as ExecCallback;
      const pty = typeof options === "object" && options !== null && "pty" in options;
      if (this.ended) throw new Error("Not connected");
      if (control.refuseNext > 0) {
        control.refuseNext--;
        queueMicrotask(() => callback(new Error("(SSH) Channel open failure: refused")));
        return;
      }
      const channel = new FakeChannel(command, pty);
      this.channels.push(channel);
      queueMicrotask(() => {
        callback(undefined, channel);
        if (pty) return; // a pty stays open until the test ends it
        // Output arrives on a later socket read, as it does over the wire.
        setImmediate(() => {
          channel.emit("data", Buffer.from(`ran ${command}`));
          channel.finish(0);
        });
      });
    }

    end(): void {
      if (this.ended) return;
      this.ended = true;
      for (const channel of this.channels) channel.finish(null);
      queueMicrotask(() => this.emit("close"));
    }

    /** The far side dropped the connection. */
    drop(): void {
      this.end();
    }
  }

  return { Client: FakeClient as unknown as ClientClass, clients, control };
}

const options = { host: "sandbox", idleTimeoutMs: 60_000 };
const pty = { term: "xterm-256color", cols: 80, rows: 24 };

describe("terminal ssh2 transport pool", () => {
  it("dials once for many execs, concurrent first callers included", async () => {
    const ssh = fakeSsh2();
    const transport = createSsh2TerminalTransport(options, ssh.Client);
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => transport.exec(`cmd ${i}`)),
    );
    expect(results.map((r) => r.stdout)).toEqual([0, 1, 2, 3, 4].map((i) => `ran cmd ${i}`));
    for (let i = 0; i < 3; i++) await transport.exec("again");
    expect(ssh.clients).toHaveLength(1);
    expect(ssh.clients[0]!.channels).toHaveLength(8);
    expect(ssh.clients[0]!.ended).toBe(false);
    transport.close();
  });

  it("redials after the connection closes", async () => {
    const ssh = fakeSsh2();
    const transport = createSsh2TerminalTransport(options, ssh.Client);
    await transport.exec("one");
    ssh.clients[0]!.drop();
    await new Promise((resolve) => setImmediate(resolve)); // the close event lands
    expect((await transport.exec("two")).stdout).toBe("ran two");
    expect(ssh.clients).toHaveLength(2);

    // Dropped but its close not seen yet: the refused exec redials.
    ssh.clients[1]!.drop();
    expect((await transport.exec("three")).stdout).toBe("ran three");
    expect(ssh.clients).toHaveLength(3);
    transport.close();
  });

  it("retries a refused channel once on a fresh connection", async () => {
    const ssh = fakeSsh2();
    const transport = createSsh2TerminalTransport(options, ssh.Client);
    await transport.exec("warm");
    ssh.control.refuseNext = 1;
    expect((await transport.exec("after refusal")).stdout).toBe("ran after refusal");
    expect(ssh.clients).toHaveLength(2);
    expect(ssh.clients[0]!.ended).toBe(true); // retired, nothing open on it
    transport.close();
  });

  it("ends the connection after the idle timeout, never while a pty is open", async () => {
    const ssh = fakeSsh2();
    const transport = createSsh2TerminalTransport({ ...options, idleTimeoutMs: 20 }, ssh.Client);
    const stream = await transport.pty("attach", pty);
    await transport.exec("while attached");
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(ssh.clients[0]!.ended).toBe(false);

    stream.destroy();
    await vi.waitFor(() => expect(ssh.clients[0]!.ended).toBe(true));
    // The next call dials again.
    await transport.exec("later");
    expect(ssh.clients).toHaveLength(2);
    transport.close();
  });

  it("closing a pty closes only its channel, not the shared connection", async () => {
    const ssh = fakeSsh2();
    const transport = createSsh2TerminalTransport(options, ssh.Client);
    const first = await transport.pty("attach 1", pty);
    const second = await transport.pty("attach 2", pty);
    const client = ssh.clients[0]!;
    const [firstChannel, secondChannel] = client.channels;

    first.destroy();
    expect(firstChannel!.closed).toBe(true);
    expect(secondChannel!.closed).toBe(false);
    expect(client.ended).toBe(false);

    // The remote end of a pty (tmux exited) closes the stream too.
    const closed = new Promise((resolve) => second.once("close", resolve));
    second.resume();
    secondChannel!.finish(0);
    expect(await second.done).toEqual({ exitCode: 0 });
    await closed;
    expect(client.ended).toBe(false);

    expect((await transport.exec("still up")).stdout).toBe("ran still up");
    expect(ssh.clients).toHaveLength(1);
    transport.close();
    expect(client.ended).toBe(true);
  });
});
