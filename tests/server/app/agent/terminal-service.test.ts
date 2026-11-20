import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { createMemoryHostKeyStore } from "../../../../packages/sandbox/src/ssh/connection";
import {
  createSandboxConnection,
  type SandboxConnection,
} from "../../../../packages/sandbox/src/ssh/sandbox-connection";
import {
  fakePty,
  startFakeSandboxServer,
  type FakePty,
  type FakeSandboxServer,
} from "../../../../packages/sandbox/src/testing-ssh-server";
import {
  createTerminalService,
  SessionLimitError,
  SessionNotFoundError,
  SessionBusyError,
  TerminalUnreachableError,
  TmuxMissingError,
} from "../../../../packages/sandbox/src/terminal/terminal";
import { fakeSandboxConnection } from "./sandbox-connection-fake";
import {
  attachCommand,
  listCommand,
  loginShellCommand,
  newSessionCommand,
  type SessionName,
} from "../../../../packages/sandbox/src/terminal/tmux";

const name = (n: number) => `ta-term-${n}` as SessionName;

type ExecReply = { stdout?: string; stderr?: string; exitCode?: number };

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
    if (/^LC_ALL=C\.UTF-8 tmux -L ta-terminal send-keys -t ta-term-\d+ -l /.test(command)) {
      return { exitCode: 0 };
    }
    const fg =
      /^LC_ALL=C\.UTF-8 tmux -L ta-terminal display-message -p -t ta-term-(\d+) '#{pane_current_command}'$/.exec(
        command,
      );
    if (fg) {
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

describe("terminal service (unit)", () => {
  it("reports unconfigured without a sandbox connection", async () => {
    const service = createTerminalService({});
    expect(await service.status()).toEqual({ kind: "unconfigured" });
    const listed = await service.list();
    expect(listed.status).toEqual({ kind: "unconfigured" });
    expect(listed.sessions).toEqual([]);
  });

  it("maps a dead sandbox to the unreachable status, in the connection's words", async () => {
    const unreachable =
      "Cannot reach the sandbox (getaddrinfo ENOTFOUND tiny-agents-vm). Is it online and on the tailnet?";
    const connection = fakeSandboxConnection({
      exec: () => {
        throw new Error(unreachable);
      },
      pty: async () => {
        throw new Error(unreachable);
      },
    });
    const service = createTerminalService({ connection });
    expect(await service.status()).toEqual({ kind: "unreachable", message: unreachable });
    await expect(service.create(80, 24)).rejects.toBeInstanceOf(TerminalUnreachableError);
    await expect(
      service.attach("ta-term-1" as SessionName, { cols: 80, rows: 24 }),
    ).rejects.toThrow(unreachable);
  });
});

describe("terminal service (integration: real ssh2 client + fake SSH server)", () => {
  let server: FakeSandboxServer;
  let vm: ReturnType<typeof fakeTmuxVm>;
  let service: ReturnType<typeof createTerminalService>;
  let connection: SandboxConnection;
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
    connection = createSandboxConnection({
      host: "127.0.0.1",
      port: server.port,
      user: "exedev",
      hostKeys: createMemoryHostKeyStore(),
    });
    service = createTerminalService({ connection });
  });

  afterAll(() => {
    connection?.close();
    server?.close();
  });

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
    expect(server.execCalls).toContain(newSessionCommand(name(1), 120, 34));
  });

  it("types a requested line into the new tab's shell, quoted, then Enter", async () => {
    vm.clear();
    const baseline = server.execCalls.length;
    await service.create(80, 24, { typeLine: `echo "it's $HOME"` });
    expect(server.execCalls.slice(baseline)).toContain(
      "LC_ALL=C.UTF-8 tmux -L ta-terminal send-keys -t ta-term-1 -l 'echo \"it'\\''s $HOME\"'" +
        " \\; send-keys -t ta-term-1 Enter",
    );
    vm.clear();
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
    expect(fake.command).toBe(attachCommand(name(1)));
    expect(fake.command).toMatch(/ \\; attach-session -t ta-term-1$/);
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

    const closed = new Promise((resolve) => stream.once("close", resolve));
    fake.end();
    expect(await stream.done).toEqual({ exitCode: 0 });
    await closed;
    vm.clear();
  });

  it("maps a missing tmux (exit 127) to the tmux-missing status", async () => {
    const missing = await startFakeSandboxServer((command) => {
      if (command.includes("tmux -V")) {
        return { stderr: "sh: 1: tmux: not found", exitCode: 127 };
      }
      return { stderr: "unexpected", exitCode: 1 };
    });
    const connection127 = createSandboxConnection({ host: "127.0.0.1", port: missing.port });
    const service127 = createTerminalService({ connection: connection127 });
    expect(await service127.status()).toEqual({
      kind: "tmux-missing",
      installCommand: "sudo apt-get install -y tmux",
    });
    await expect(service127.create(80, 24)).rejects.toBeInstanceOf(TmuxMissingError);
    connection127.close();
    missing.close();
  });
});
