/**
 * Terminal service (issue #28), integration: the real ssh2 client against
 * the in-process fake SSH server. Asserts the exact tmux command lines the
 * VM sees (the strings are the frozen contract with tmux 3.4), byte flow
 * through fake ptys, and the fresh-connection-per-attach invariant.
 */
import { Duplex } from "node:stream";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { createMemoryHostKeyStore } from "../../../../packages/agent/src/toolkits/sandbox";
import {
  fakePty,
  startFakeSandboxServer,
  type FakePty,
  type FakeSandboxServer,
} from "../../../../packages/agent/src/testing-ssh-server";
import {
  createTerminalService,
  SessionLimitError,
  SessionNotFoundError,
  SessionBusyError,
  TerminalUnreachableError,
  TmuxMissingError,
  type PtyStream,
} from "../../../../packages/agent/src/terminal/terminal";
import { createSsh2TerminalTransport } from "../../../../packages/agent/src/terminal/terminal-ssh2";
import {
  listCommand,
  loginShellCommand,
  type SessionName,
} from "../../../../packages/agent/src/terminal/tmux";

const name = (n: number) => `ta-term-${n}` as SessionName;
const id = (session: string) => session.slice("ta-term-".length);

type ExecReply = { stdout?: string; stderr?: string; exitCode?: number };

/**
 * A fake VM running tmux in memory: session numbers → createdAt, plus a
 * busy map holding each session's foreground process. Unknown commands are
 * answered with an error so a contract drift is loud, not silent.
 */
function fakeTmuxVm() {
  const created = new Map<string, number>();
  const busy: Record<string, string> = {};
  const exec = (command: string): ExecReply | null => {
    if (command === listCommand()) {
      const rows = [...created]
        .map(([n, at]) => `ta-term-${n}\t${at}\t0\t${busy[n] ?? "bash"}`)
        .join("\n");
      return { stdout: `tmux 3.4\n${rows}${rows ? "\n" : ""}`, exitCode: 0 };
    }
    const ns =
      /^LC_ALL=C\.UTF-8 tmux -L ta-terminal new-session -d -s ta-term-(\d+) -x (\d+) -y (\d+) \\; set -g status off/.exec(
        command,
      );
    if (ns) {
      created.set(ns[1]!, 1792605227 + created.size);
      return { exitCode: 0 };
    }
    if (command === loginShellCommand()) return { stdout: "bash\n", exitCode: 0 };
    const fg =
      /^LC_ALL=C\.UTF-8 tmux -L ta-terminal display-message -p -t ta-term-(\d+) '#{pane_current_command}'$/.exec(
        command,
      );
    if (fg) {
      // tmux 3.4 quirk: a missing target exits 0 with empty output.
      if (!created.has(fg[1]!)) return { stdout: "", exitCode: 0 };
      return { stdout: `${busy[fg[1]!] ?? "bash"}\n`, exitCode: 0 };
    }
    const has = /^LC_ALL=C\.UTF-8 tmux -L ta-terminal has-session -t ta-term-(\d+)$/.exec(command);
    if (has) {
      return created.has(has[1]!) ? { exitCode: 0 } : { stderr: "can't find session", exitCode: 1 };
    }
    const kill = /^LC_ALL=C\.UTF-8 tmux -L ta-terminal kill-session -t ta-term-(\d+)$/.exec(
      command,
    );
    if (kill) {
      if (!created.has(kill[1]!)) return { stderr: "can't find session", exitCode: 1 };
      created.delete(kill[1]!);
      return { exitCode: 0 };
    }
    return null;
  };
  return {
    created,
    busy,
    exec,
    clear: () => {
      created.clear();
      for (const k of Object.keys(busy)) delete busy[k];
    },
  };
}

/** The service's PtyStream over a FakePty: what the fake server hands back. */
class FakePtyStream extends Duplex implements PtyStream {
  constructor(readonly fake: FakePty) {
    super({});
    let resolveDone!: (value: { exitCode: number | null }) => void;
    this.done = new Promise((resolve) => {
      resolveDone = resolve;
    });
    let buffered: Buffer[] = [];
    let opened = false;
    // The ssh2 stream binds after the handler returns; queue until then.
    const flush = () => {
      for (const b of buffered) this.push(b);
      buffered = [];
    };
    this.fake.emit = (data) => void data; // replaced once the real bind lands
    queueMicrotask(() => {
      opened = true;
      flush();
    });
    void opened;
    void buffered;
  }
  declare readonly done: Promise<{ exitCode: number | null }>;
  setWindow(rows: number, cols: number): void {
    this.fake.setWindow(cols, rows);
  }
  override _read(): void {}
  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.fake.emit(chunk);
    callback();
  }
  override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    this.fake.end();
    callback(error);
  }
}

describe("terminal service (unit)", () => {
  it("reports unconfigured when no host and no transport are given", async () => {
    const service = createTerminalService({});
    expect(await service.status()).toEqual({ kind: "unconfigured" });
    const listed = await service.list();
    expect(listed.status).toEqual({ kind: "unconfigured" });
    expect(listed.sessions).toEqual([]);
  });

  it("maps a dead sandbox to the unreachable status", async () => {
    const service = createTerminalService({
      transport: {
        exec: async () => {
          throw new Error("connect ECONNREFUSED 100.77.69.117:22");
        },
        pty: async () => {
          throw new Error("connect ECONNREFUSED");
        },
      },
    });
    expect(await service.status()).toMatchObject({ kind: "unreachable" });
    await expect(service.create(80, 24)).rejects.toBeInstanceOf(TerminalUnreachableError);
  });

  it("describes an unreachable sandbox once, not nested", async () => {
    const service = createTerminalService({
      transport: {
        exec: async () => {
          throw new Error("getaddrinfo ENOTFOUND tiny-agents-vm");
        },
        pty: async () => {
          throw new Error("getaddrinfo ENOTFOUND tiny-agents-vm");
        },
      },
    });
    const { status } = await service.list();
    expect(status).toEqual({
      kind: "unreachable",
      message:
        "Cannot reach the sandbox (getaddrinfo ENOTFOUND tiny-agents-vm). Is it online and on the tailnet?",
    });
  });
});

describe("terminal service (integration: real ssh2 client + fake SSH server)", () => {
  let server: FakeSandboxServer;
  let vm: ReturnType<typeof fakeTmuxVm>;
  let service: ReturnType<typeof createTerminalService>;
  const attached: FakePty[] = [];

  beforeAll(async () => {
    vm = fakeTmuxVm();
    server = await startFakeSandboxServer(
      (command) => {
        const reply = vm.exec(command);
        return reply ?? { stderr: `unexpected command: ${command}`, exitCode: 1 };
      },
      (command, info) => {
        const fake = fakePty(command, info);
        attached.push(fake);
        return fake;
      },
    );
    const keys = createMemoryHostKeyStore();
    service = createTerminalService({
      host: "127.0.0.1",
      port: server.port,
      user: "exedev",
      hostKeys: keys,
      transport: createSsh2TerminalTransport({
        host: "127.0.0.1",
        port: server.port,
        user: "exedev",
        hostKeys: keys,
      }),
    });
  });

  afterAll(() => server?.close());

  it("lists sessions parsed from the exact live-verified ls line", async () => {
    vm.created.set("1", 1792605227);
    vm.created.set("2", 1792605300);
    vm.busy["2"] = "vim";
    const { status, sessions } = await service.list();
    expect(status).toEqual({ kind: "ready" });
    expect(sessions).toEqual([
      { name: "ta-term-1", foreground: "bash", attached: false, createdAt: 1792605227 },
      { name: "ta-term-2", foreground: "vim", attached: false, createdAt: 1792605300 },
    ]);
    vm.clear();
  });

  it("sends the exact command strings the VM must see", async () => {
    vm.clear();
    const baseline = server.execCalls.length;
    await service.list();
    expect(server.execCalls[baseline]).toBe(listCommand());
    await service.create(120, 34);
    expect(server.execCalls).toContain(
      "LC_ALL=C.UTF-8 tmux -L ta-terminal new-session -d -s ta-term-1 -x 120 -y 34" +
        " \\; set -g status off" +
        " \\; set -g mouse on" +
        " \\; set -g history-limit 50000" +
        " \\; set -g escape-time 10",
    );
  });

  it("creates at the lowest free number and refuses past 12", { timeout: 20_000 }, async () => {
    vm.clear();
    expect((await service.create(80, 24)).name).toBe("ta-term-1");
    expect((await service.create(80, 24)).name).toBe("ta-term-2");
    await service.kill(name(1));
    expect((await service.create(80, 24)).name).toBe("ta-term-1");
    for (let i = 0; i < 10; i++) await service.create(80, 24);
    await expect(service.create(80, 24)).rejects.toBeInstanceOf(SessionLimitError);
    vm.clear();
  });

  it("kills a plain shell at once, asks before killing a busy pane", async () => {
    vm.clear();
    await service.create(80, 24);
    await expect(service.kill(name(1))).resolves.toBeUndefined();
    await expect(service.kill(name(1))).rejects.toBeInstanceOf(SessionNotFoundError);

    await service.create(80, 24);
    vm.busy["1"] = "vim";
    await expect(service.kill(name(1))).rejects.toBeInstanceOf(SessionBusyError);
    await expect(service.kill(name(1), { force: true })).resolves.toBeUndefined();
    vm.clear();
  });

  it("has() answers via has-session exit codes", async () => {
    vm.clear();
    await service.create(80, 24);
    expect(await service.has(name(1))).toBe(true);
    expect(await service.has(name(5))).toBe(false);
    vm.clear();
  });

  it("attaches over a pty channel: bytes both ways, setWindow, done on end", async () => {
    vm.clear();
    await service.create(120, 34);
    const stream = await service.attach(name(1), { cols: 100, rows: 30 });
    const saw: Buffer[] = [];
    stream.on("data", (b: Buffer) => saw.push(b));
    const fake = attached.at(-1)!;
    expect(fake.command).toBe("LC_ALL=C.UTF-8 tmux -L ta-terminal attach-session -d -t ta-term-1");
    expect(fake.term).toBe("xterm-256color");
    expect(fake.cols).toBe(100);
    expect(fake.rows).toBe(30);

    stream.write(Buffer.from("echo hi\n"));
    stream.setWindow(40, 120);
    await vi.waitFor(() => expect(Buffer.concat(fake.written).toString()).toContain("echo hi"));
    expect(fake.cols).toBe(120);
    expect(fake.rows).toBe(40);

    fake.emit("hello from vm");
    await vi.waitFor(() => expect(Buffer.concat(saw).toString()).toContain("hello from vm"));

    fake.end();
    expect(await stream.done).toEqual({ exitCode: 0 });
    vm.clear();
  });

  it("uses a fresh connection per attach (no pooling)", async () => {
    vm.clear();
    await service.create(80, 24);
    const before = server.connections;
    const streams = [];
    for (let i = 0; i < 3; i++) {
      streams.push(await service.attach(name(1), { cols: 80, rows: 24 }));
    }
    expect(server.connections).toBeGreaterThanOrEqual(before + 3);
    for (const s of streams) s.destroy();
    vm.clear();
  });

  it("maps a missing tmux (exit 127) to the tmux-missing status", async () => {
    const missing = await startFakeSandboxServer((command) => {
      if (command.includes("tmux -V")) {
        return { stderr: "sh: 1: tmux: not found", exitCode: 127 };
      }
      return { stderr: "unexpected", exitCode: 1 };
    });
    const service127 = createTerminalService({
      transport: createSsh2TerminalTransport({
        host: "127.0.0.1",
        port: missing.port,
      }),
    });
    expect(await service127.status()).toEqual({
      kind: "tmux-missing",
      installCommand: "sudo apt-get install -y tmux",
    });
    await expect(service127.create(80, 24)).rejects.toBeInstanceOf(TmuxMissingError);
    missing.close();
  });
});
