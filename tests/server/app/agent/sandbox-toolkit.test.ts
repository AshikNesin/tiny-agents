/**
 * The sandbox toolkit (issue #19): unit tests against a fake transport and
 * integration tests through the in-process SSH server (real ssh2 client,
 * real wire protocol, none-auth — the shape Tailscale SSH presents).
 */
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ToolExecutionApi, ToolExecutionResult } from "@earendil-works/pi-durable";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import {
  createMemoryHostKeyStore,
  createSandboxToolkit,
  PreDispatchError,
  type ExecResult,
  type SandboxSession,
  type SandboxTransport,
} from "../../../../packages/agent/src/toolkits/sandbox";
import { startFakeSandboxServer } from "../../../../packages/agent/src/testing-ssh-server";
import type { Capability } from "../../../../packages/agent/src/capabilities";

async function run(capability: Capability, name: string, args: Record<string, unknown>) {
  const tool = capability.extension.tools!.find((t) => t.name === name)!;
  const result = (await tool.execute(
    args as never,
    {} as ToolExecutionApi,
    BACKGROUND_CONTEXT,
  )) as ToolExecutionResult;
  const text = (result.output ?? []).map((b) => (b.type === "text" ? b.text : "")).join("");
  return { ...result, text };
}

/** Records dial()s; optionally fails the first n sessions with a given error. */
function fakeTransport(execReply: (command: string) => ExecResult, opts: { kills?: number } = {}) {
  const calls: string[] = [];
  let dials = 0;
  let killed = 0;
  const transport: SandboxTransport = async () => {
    dials++;
    const dead = () => killed++ < (opts.kills ?? 0);
    const session: SandboxSession = {
      exec: async (command) => {
        if (dead()) throw new PreDispatchError("channel open refused: connection dead");
        calls.push(command);
        return execReply(command);
      },
      readFile: async () => {
        if (dead()) throw new Error("Keepalive timeout");
        throw new Error("unused");
      },
      writeFile: async () => {
        if (dead()) throw new Error("Keepalive timeout");
        throw new Error("unused");
      },
      close: () => {},
    };
    return session;
  };
  return {
    transport,
    calls,
    get dials() {
      return dials;
    },
  };
}

describe("sandbox toolkit (unit, fake transport)", () => {
  it("shows a setup hint when SANDBOX_HOST is unset", () => {
    const sandbox = createSandboxToolkit({});
    expect(sandbox.setupHint).toContain("SANDBOX_HOST");
    expect(sandbox.id).toBe("sandbox");
  });

  it("declares tool metadata: read_file read-only, side-effecting tools not", () => {
    const sandbox = createSandboxToolkit({ host: "x" });
    const byName = Object.fromEntries(sandbox.tools.map((t) => [t.name, t]));
    expect(byName.read_file.readOnly).toBe(true);
    expect(byName.run_command.readOnly).toBeUndefined();
    expect(byName.write_file.readOnly).toBeUndefined();
  });

  it("returns output and exit code for a successful command", async () => {
    const fake = fakeTransport((c) => ({ output: `ran: ${c}`, exitCode: 0 }));
    const sandbox = createSandboxToolkit({ host: "vm", transport: fake.transport });
    const result = await run(sandbox, "run_command", { command: "ls" });
    expect(result.text).toBe("ran: ls");
    expect(result.isError).toBeUndefined();
    expect(result.details).toEqual({ exitCode: 0 });
  });

  it("wraps nonzero exit codes as tool errors with the code and output", async () => {
    const fake = fakeTransport(() => ({ output: "boom", exitCode: 127 }));
    const sandbox = createSandboxToolkit({ host: "vm", transport: fake.transport });
    const result = await run(sandbox, "run_command", { command: "nope" });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("exit 127");
    expect(result.text).toContain("boom");
  });

  it("wraps unreachable-host errors as one readable line", async () => {
    const dead: SandboxTransport = async () => {
      throw new Error("connect ECONNREFUSED 100.77.69.117:22");
    };
    const sandbox = createSandboxToolkit({ host: "vm", transport: dead });
    const result = await run(sandbox, "run_command", { command: "ls" });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("Cannot reach the sandbox");
  });

  it("marks replay policy: read_file safe, side effects unsafe", () => {
    const sandbox = createSandboxToolkit({ host: "x" });
    const policy = Object.fromEntries(sandbox.extension.tools!.map((t) => [t.name, t.replay]));
    expect(policy).toEqual({ run_command: "unsafe", read_file: "safe", write_file: "unsafe" });
  });

  it("pools one connection and redials once when the pooled one dies", async () => {
    const fake = fakeTransport((c) => ({ output: c, exitCode: 0 }), { kills: 1 });
    const sandbox = createSandboxToolkit({ host: "vm", transport: fake.transport });
    const first = await run(sandbox, "run_command", { command: "one" });
    const second = await run(sandbox, "run_command", { command: "two" });
    expect(first.isError).toBeUndefined();
    expect(second.isError).toBeUndefined();
    expect(fake.calls).toEqual(["one", "two"]);
    expect(fake.dials).toBe(2); // died once, redialed once, then reused
    await run(sandbox, "run_command", { command: "three" });
    expect(fake.dials).toBe(2);
    expect(fake.calls).toEqual(["one", "two", "three"]);
  });

  it("surfaces post-dispatch failures instead of re-running the command", async () => {
    const calls: string[] = [];
    const transport: SandboxTransport = async () => ({
      exec: async (command) => {
        calls.push(command);
        throw new Error("Command timed out after 5s"); // dispatched, then died
      },
      readFile: async () => ({ text: "", truncated: false }),
      writeFile: async () => {},
      close: () => {},
    });
    const sandbox = createSandboxToolkit({ host: "vm", transport });
    const result = await run(sandbox, "run_command", { command: "cargo build" });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("timed out");
    expect(calls).toEqual(["cargo build"]); // exactly once
  });

  it("refuses to dial when unconfigured, even if the capability is enabled", async () => {
    const sandbox = createSandboxToolkit({ host: undefined });
    const result = await run(sandbox, "run_command", { command: "ls" });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("SANDBOX_HOST");
  });

  it("wraps detached commands in setsid/nohup and returns the pid line", async () => {
    const fake = fakeTransport((c) => ({
      output: c.includes("setsid") ? "4242" : "no",
      exitCode: 0,
    }));
    const sandbox = createSandboxToolkit({ host: "vm", transport: fake.transport });
    const result = await run(sandbox, "run_command", { command: "npm run build", detached: true });
    expect(result.isError).toBeUndefined();
    expect(fake.calls[0]).toMatch(/^setsid nohup sh -c 'npm run build' >/);
    expect(result.text).toContain("4242");
  });
});

describe("sandbox toolkit (integration, in-process SSH server)", () => {
  let server: Awaited<ReturnType<typeof startFakeSandboxServer>>;

  beforeAll(async () => {
    server = await startFakeSandboxServer((command) => {
      if (command.startsWith("echo ")) return { stdout: command.slice(5) };
      if (command === "false") return { stdout: "", exitCode: 1 };
      return { stdout: "" };
    });
  });

  afterAll(() => server?.close());

  const toolkit = () =>
    createSandboxToolkit({
      host: "127.0.0.1",
      port: server.port,
      user: "exedev",
      hostKeys: createMemoryHostKeyStore(),
    });

  it("runs commands over the real ssh2 client with none-auth", async () => {
    const sandbox = toolkit();
    const result = await run(sandbox, "run_command", { command: "echo hello from the wire" });
    expect(result.text).toContain("hello from the wire");
    expect(server.execCalls).toContain("echo hello from the wire");
  });

  it("pins the host key on first connect (TOFU) and reuses the connection", async () => {
    const keys = createMemoryHostKeyStore();
    const sandbox = createSandboxToolkit({
      host: "127.0.0.1",
      port: server.port,
      hostKeys: keys,
    });
    await run(sandbox, "run_command", { command: "echo one" });
    const pinned = await keys.get("127.0.0.1");
    expect(pinned).toMatch(/^sha256:/);
    await run(sandbox, "run_command", { command: "echo two" });
    expect(await keys.get("127.0.0.1")).toBe(pinned);
  });

  it("writes then reads a file through real SFTP, round-trip intact", async () => {
    const sandbox = toolkit();
    const payload = "line one\nline two — ünïcödé ✓\n";
    const wrote = await run(sandbox, "write_file", { path: "/notes.txt", content: payload });
    expect(wrote.isError).toBeUndefined();
    const read = await run(sandbox, "read_file", { path: "/notes.txt" });
    expect(read.text).toBe(payload);
  });

  it("overwrites an existing file atomically (temp name then rename)", async () => {
    const sandbox = toolkit();
    await run(sandbox, "write_file", { path: "/over.txt", content: "first" });
    await run(sandbox, "write_file", { path: "/over.txt", content: "second, longer" });
    const read = await run(sandbox, "read_file", { path: "/over.txt" });
    expect(read.text).toBe("second, longer");
  });

  it("reads a missing file as a readable error", async () => {
    const sandbox = toolkit();
    const result = await run(sandbox, "read_file", { path: "/nope.txt" });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/no such file/i);
  });

  it("reports nonzero exits from the real server", async () => {
    const sandbox = toolkit();
    const result = await run(sandbox, "run_command", { command: "false" });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("exit 1");
  });
});
