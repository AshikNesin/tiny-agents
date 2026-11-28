import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer, type Server } from "node:http";
import { connect, createServer as createTcpServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseJson } from "../../../../packages/std/src/index";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { z } from "zod";
import { createMicrovmBridge, HOOK_PREFIX } from "../../../../packages/sandbox/src/microvm/bridge";
import {
  microvmMachine,
  type MicrovmApi,
  type MicrovmInfo,
  type MicrovmRecord,
  type MicrovmState,
  type OpenStream,
} from "../../../../packages/sandbox/src/microvm/machine";
import { openWebSocketStream } from "../../../../packages/sandbox/src/microvm/websocket";
import { createSandboxConnection } from "../../../../packages/sandbox/src/ssh/sandbox-connection";
import type { SandboxMachine } from "../../../../packages/sandbox/src/ssh/machine";
import {
  startFakeSandboxServer,
  type ExecHandler,
  type FakeSandboxServer,
} from "../../../../packages/sandbox/src/testing-ssh-server";
import { FIXED_NOW } from "../../../test-clock";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

const echo: ExecHandler = (command) =>
  command.startsWith("echo ") ? { stdout: command.slice(5) } : { stdout: "" };
const text = (result: { stdout: Buffer }) => result.stdout.toString("utf8");
const HOUR_MS = 60 * 60_000;
const RunPayload = z.object({ authorizedKey: z.string() });
const authorizedKeyOf = (payload: string) =>
  parseJson("run payload", payload, RunPayload).authorizedKey;

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => server.close());
  return (server.address() as { port: number }).port;
}

async function bridgeTo(sshPort: number, authorize = async (_key: string) => {}) {
  const port = await listen(createMicrovmBridge({ sshPort, authorize }));
  return `http://127.0.0.1:${port}`;
}

describe("SSH through the MicroVM bridge", () => {
  it("runs commands and forwards ports over SSH carried by a WebSocket", async () => {
    const ssh = await startFakeSandboxServer(echo, null);
    cleanups.push(() => ssh.close());
    const base = await bridgeTo(ssh.port);
    const machine: SandboxMachine = {
      label: "bridged",
      async ready() {},
      async dial() {
        return {
          host: "vm-bridged",
          sock: await openWebSocketStream(`${base.replace("http", "ws")}/`, {}),
        };
      },
    };
    const connection = createSandboxConnection(machine);
    cleanups.push(() => connection.close());

    expect(text(await connection.exec("echo through the bridge"))).toBe("through the bridge");

    const service = createTcpServer((socket) => socket.pipe(socket));
    const servicePort = await listen(service as unknown as Server);
    const tunnel = await connection.forward(servicePort);
    const echoed = new Promise<string>((resolve) =>
      tunnel.once("data", (d: Buffer) => resolve(String(d))),
    );
    tunnel.write("ping");
    expect(await echoed).toBe("ping");
    tunnel.destroy();
  });

  it("says what the endpoint answered when it refuses the WebSocket", async () => {
    const refusing = createHttpServer().on("upgrade", (_req, socket) => {
      socket.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n");
    });
    const port = await listen(refusing);
    await expect(openWebSocketStream(`ws://127.0.0.1:${port}/`, {})).rejects.toThrow(
      "The sandbox endpoint refused the connection (HTTP 403).",
    );
  });
});

describe("the bridge's lifecycle hooks", () => {
  it("authorizes the key from the run payload once, and refuses a second key", async () => {
    const ssh = await startFakeSandboxServer(echo, null);
    cleanups.push(() => ssh.close());
    const dir = mkdtempSync(path.join(tmpdir(), "microvm-bridge-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const keys = path.join(dir, "authorized_keys");
    const base = await bridgeTo(ssh.port, async (key) => writeFileSync(keys, `${key}\n`));

    const run = (body: string) => fetch(`${base}${HOOK_PREFIX}run`, { method: "POST", body });
    const first = await run(JSON.stringify({ authorizedKey: "ssh-ed25519 AAAAfirst app" }));
    expect(first.status).toBe(200);
    expect(readFileSync(keys, "utf8")).toBe("ssh-ed25519 AAAAfirst app\n");

    const second = await run(JSON.stringify({ authorizedKey: "ssh-ed25519 AAAAsecond attacker" }));
    expect(second.status).toBe(409);
    expect(readFileSync(keys, "utf8")).toBe("ssh-ed25519 AAAAfirst app\n");
  });

  it("refuses a run payload that is not a public key", async () => {
    const ssh = await startFakeSandboxServer(echo, null);
    cleanups.push(() => ssh.close());
    const base = await bridgeTo(ssh.port);
    const response = await fetch(`${base}${HOOK_PREFIX}run`, {
      method: "POST",
      body: JSON.stringify({ authorizedKey: "not a key" }),
    });
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("The run payload does not fit its shape");
  });

  it("answers ready only once sshd accepts connections", async () => {
    const closed = createTcpServer();
    const closedPort = await listen(closed as unknown as Server);
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    const down = await bridgeTo(closedPort);
    expect((await fetch(`${down}${HOOK_PREFIX}ready`)).status).toBe(503);

    const ssh = await startFakeSandboxServer(echo, null);
    cleanups.push(() => ssh.close());
    const up = await bridgeTo(ssh.port);
    expect((await fetch(`${up}${HOOK_PREFIX}ready`)).status).toBe(200);
    expect((await fetch(`${up}/anything-else`)).status).toBe(404);
  });
});

interface FakeVm extends MicrovmInfo {
  payload: string;
  server?: FakeSandboxServer;
}

function fakeAws(clock: { now: number }) {
  const vms = new Map<string, FakeVm>();
  const calls: string[] = [];
  let tokens = 0;
  let started = 0;
  let pendingPolls = 0;
  const api: MicrovmApi = {
    async run(payload) {
      const id = `vm-${++started}`;
      calls.push(`run ${id}`);
      const vm: FakeVm = {
        id,
        state: pendingPolls > 0 ? "PENDING" : "RUNNING",
        endpoint: `${id}.lambda-microvm.us-east-1.on.aws`,
        startedAt: new Date(clock.now),
        maximumDurationSeconds: 8 * 60 * 60,
        payload,
      };
      vms.set(id, vm);
      return { ...vm };
    },
    async get(id) {
      calls.push(`get ${id}`);
      const vm = vms.get(id);
      if (!vm) return undefined;
      if (vm.state === "PENDING" && --pendingPolls <= 0) vm.state = "RUNNING";
      return { ...vm };
    },
    async resume(id) {
      calls.push(`resume ${id}`);
      vms.get(id)!.state = "RUNNING";
    },
    async authToken(id, port, minutes) {
      calls.push(`token ${id} ${port} ${minutes}`);
      tokens++;
      return `token-${tokens}`;
    },
  };
  return {
    api,
    vms,
    calls,
    setState(id: string, state: MicrovmState) {
      vms.get(id)!.state = state;
    },
    pendFor(polls: number) {
      pendingPolls = polls;
    },
  };
}

function memoryRecords() {
  let saved: MicrovmRecord | undefined;
  return {
    get: async () => saved,
    set: async (record: MicrovmRecord) => {
      saved = record;
    },
    peek: () => saved,
  };
}

function sshInsideFakeVms(aws: ReturnType<typeof fakeAws>): OpenStream {
  return async (url) => {
    const id = new URL(url).hostname.split(".")[0]!;
    const vm = aws.vms.get(id)!;
    if (!vm.server) {
      vm.server = await startFakeSandboxServer(echo, null, {
        authorizedKey: authorizedKeyOf(vm.payload),
      });
      const server = vm.server;
      cleanups.push(() => server.close());
    }
    return connect({ host: "127.0.0.1", port: vm.server.port });
  };
}

function setup(clock = { now: Date.parse(FIXED_NOW) }) {
  const aws = fakeAws(clock);
  const records = memoryRecords();
  const replaced: string[] = [];
  const machine = (openStream: OpenStream = sshInsideFakeVms(aws)) =>
    microvmMachine({
      api: aws.api,
      records,
      openStream,
      now: () => clock.now,
      sleep: async () => {},
      onReplaced: (previous, next) => replaced.push(`${previous} -> ${next}`),
    });
  const connect = (m: SandboxMachine = machine()) => {
    const connection = createSandboxConnection(m);
    cleanups.push(() => connection.close());
    return connection;
  };
  return { aws, records, replaced, machine, connect, clock };
}

describe("the MicroVM machine", () => {
  it("starts a VM with a key of its own, and SSH logs in with that key", async () => {
    const { aws, records, connect } = setup();
    expect(text(await connect().exec("echo hello vm"))).toBe("hello vm");
    expect(aws.calls.filter((c) => c.startsWith("run"))).toEqual(["run vm-1"]);
    expect(authorizedKeyOf(aws.vms.get("vm-1")!.payload)).toMatch(/^ssh-ed25519 /);
    expect(records.peek()).toMatchObject({ id: "vm-1" });
    expect(records.peek()!.privateKey).toContain("OPENSSH PRIVATE KEY");
  });

  it("reuses the saved VM and its key after a restart", async () => {
    const { aws, connect, machine } = setup();
    await connect().exec("echo first");
    expect(text(await connect(machine()).exec("echo after restart"))).toBe("after restart");
    expect(aws.calls.filter((c) => c.startsWith("run"))).toEqual(["run vm-1"]);
  });

  it("resumes a suspended VM before dialing it", async () => {
    const { aws, connect, machine } = setup();
    await connect().exec("echo first");
    aws.setState("vm-1", "SUSPENDED");
    expect(text(await connect(machine()).exec("echo awake"))).toBe("awake");
    expect(aws.calls).toContain("resume vm-1");
    expect(aws.calls.filter((c) => c.startsWith("run"))).toEqual(["run vm-1"]);
  });

  it("starts a new VM when the saved one ends within 30 minutes, and reports the swap", async () => {
    const { aws, connect, machine, replaced, records, clock } = setup();
    await connect().exec("echo first");
    clock.now += 7.6 * HOUR_MS;
    expect(text(await connect(machine()).exec("echo fresh"))).toBe("fresh");
    expect(aws.calls.filter((c) => c.startsWith("run"))).toEqual(["run vm-1", "run vm-2"]);
    expect(replaced).toEqual(["vm-1 -> vm-2"]);
    expect(records.peek()).toMatchObject({ id: "vm-2" });
  });

  it("keeps a VM with more than 30 minutes left", async () => {
    const { aws, connect, machine, clock } = setup();
    await connect().exec("echo first");
    clock.now += 7.4 * HOUR_MS;
    await connect(machine()).exec("echo same");
    expect(aws.calls.filter((c) => c.startsWith("run"))).toEqual(["run vm-1"]);
  });

  it("starts a new VM when AWS no longer knows the saved one", async () => {
    const { aws, connect, machine, replaced } = setup();
    await connect().exec("echo first");
    aws.vms.delete("vm-1");
    await connect(machine()).exec("echo replaced");
    expect(replaced).toEqual(["vm-1 -> vm-2"]);
  });

  it("waits for a pending VM to run before dialing", async () => {
    const { aws, connect } = setup();
    aws.pendFor(3);
    expect(text(await connect().exec("echo started"))).toBe("started");
    expect(aws.calls.filter((c) => c === "get vm-1").length).toBeGreaterThanOrEqual(3);
  });

  it("gives up on a VM that never starts, and says which state it is stuck in", async () => {
    const clock = { now: Date.parse(FIXED_NOW) };
    const { aws } = setup(clock);
    aws.pendFor(Number.POSITIVE_INFINITY);
    const machine = microvmMachine({
      api: aws.api,
      records: memoryRecords(),
      openStream: sshInsideFakeVms(aws),
      now: () => clock.now,
      sleep: async (ms) => {
        clock.now += ms;
      },
      startTimeoutMs: 5_000,
    });
    await expect(machine.ready()).rejects.toThrow(
      "The sandbox MicroVM vm-1 is still PENDING after 5s.",
    );
  });

  it("starts one VM for parallel first callers", async () => {
    const { aws, machine } = setup();
    const m = machine();
    await Promise.all([m.ready(), m.ready(), m.ready()]);
    expect(aws.calls.filter((c) => c.startsWith("run"))).toEqual(["run vm-1"]);
  });

  it("dials the VM's endpoint over wss with a cached token for the bridge port", async () => {
    const { machine, clock } = setup();
    const opened: { url: string; headers: Record<string, string> }[] = [];
    const m = machine(async (url, headers) => {
      opened.push({ url, headers });
      return connect({ host: "127.0.0.1", port: 9 });
    });
    await m.ready();
    const first = await m.dial();
    first.sock?.destroy();
    clock.now += 50 * 60_000;
    (await m.dial()).sock?.destroy();
    clock.now += 6 * 60_000;
    (await m.dial()).sock?.destroy();

    expect(first).toMatchObject({ host: "vm-1" });
    expect(opened.map((o) => o.url)).toEqual([
      "wss://vm-1.lambda-microvm.us-east-1.on.aws",
      "wss://vm-1.lambda-microvm.us-east-1.on.aws",
      "wss://vm-1.lambda-microvm.us-east-1.on.aws",
    ]);
    expect(opened.map((o) => o.headers)).toEqual([
      { "X-aws-proxy-auth": "token-1", "X-aws-proxy-port": "8080" },
      { "X-aws-proxy-auth": "token-1", "X-aws-proxy-port": "8080" },
      { "X-aws-proxy-auth": "token-2", "X-aws-proxy-port": "8080" },
    ]);
  });
});
