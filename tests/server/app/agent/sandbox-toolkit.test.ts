import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ToolExecutionApi, ToolExecutionResult } from "@earendil-works/pi-durable";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { createSandboxToolkit } from "../../../../packages/agent/src/toolkits/sandbox";
import { SandboxTimeoutError } from "../../../../packages/sandbox/src/ssh/connection";
import {
  createSandboxConnection,
  type SandboxConnection,
} from "../../../../packages/sandbox/src/ssh/sandbox-connection";
import { startFakeSandboxServer } from "../../../../packages/sandbox/src/testing-ssh-server";
import type { Capability } from "../../../../packages/agent/src/capabilities";
import { fakeSandboxConnection } from "./sandbox-connection-fake";

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

describe("sandbox toolkit (unit, in-memory connection)", () => {
  it("shows a setup hint without a sandbox connection", () => {
    const sandbox = createSandboxToolkit({});
    expect(sandbox.setupHint).toContain("SANDBOX_HOST");
    expect(sandbox.id).toBe("sandbox");
  });

  it("declares tool metadata: read_file read-only, side-effecting tools not", () => {
    const sandbox = createSandboxToolkit({ connection: fakeSandboxConnection() });
    const byName = Object.fromEntries(sandbox.tools.map((t) => [t.name, t]));
    expect(byName.read_file.readOnly).toBe(true);
    expect(byName.run_command.readOnly).toBeUndefined();
    expect(byName.write_file.readOnly).toBeUndefined();
  });

  it("returns output and exit code for a successful command", async () => {
    const connection = fakeSandboxConnection({ exec: (c) => ({ stdout: `ran: ${c}` }) });
    const sandbox = createSandboxToolkit({ connection });
    const result = await run(sandbox, "run_command", { command: "ls" });
    expect(result.text).toBe("ran: ls");
    expect(result.isError).toBeUndefined();
    expect(result.details).toEqual({ exitCode: 0 });
    expect(connection.execs[0]!.options).toEqual({ timeoutMs: 120_000, maxBytes: 60_000 });
  });

  it("puts stderr after stdout and caps what reaches the model", async () => {
    const connection = fakeSandboxConnection({
      exec: (c) =>
        c === "noisy" ? { stdout: "out\n", stderr: "warn\n" } : { stdout: "y".repeat(40_000) },
    });
    const sandbox = createSandboxToolkit({ connection });
    expect((await run(sandbox, "run_command", { command: "noisy" })).text).toBe("out\n\nwarn");
    const big = await run(sandbox, "run_command", { command: "big" });
    expect(big.text).toHaveLength(30_000 + "\n… (truncated)".length);
    expect(big.text.endsWith("… (truncated)")).toBe(true);
  });

  it("wraps nonzero exit codes as tool errors with the code and output", async () => {
    const connection = fakeSandboxConnection({ exec: () => ({ stdout: "boom", exitCode: 127 }) });
    const sandbox = createSandboxToolkit({ connection });
    const result = await run(sandbox, "run_command", { command: "nope" });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("exit 127");
    expect(result.text).toContain("boom");
  });

  it("reports a connection failure as the connection words it", async () => {
    const connection = fakeSandboxConnection({
      exec: () => {
        throw new Error(
          "Cannot reach the sandbox (connect ECONNREFUSED 100.77.69.117:22). Is it online and on the tailnet?",
        );
      },
    });
    const result = await run(createSandboxToolkit({ connection }), "run_command", {
      command: "ls",
    });
    expect(result).toMatchObject({
      isError: true,
      text: "Cannot reach the sandbox (connect ECONNREFUSED 100.77.69.117:22). Is it online and on the tailnet?",
    });
  });

  it("explains a timeout with the way out", async () => {
    const connection = fakeSandboxConnection({
      exec: (_c, options) => {
        throw new SandboxTimeoutError(options.timeoutMs!);
      },
    });
    const sandbox = createSandboxToolkit({ connection });
    const result = await run(sandbox, "run_command", { command: "cargo build", timeout_secs: 5 });
    expect(result.isError).toBe(true);
    expect(result.text).toBe(
      "Command timed out after 5s. Rerun with detached:true if it must keep running.",
    );
    expect(connection.execs).toHaveLength(1);
  });

  it("marks replay policy: read_file safe, side effects unsafe", () => {
    const sandbox = createSandboxToolkit({});
    const policy = Object.fromEntries(sandbox.extension.tools!.map((t) => [t.name, t.replay]));
    expect(policy).toEqual({ run_command: "unsafe", read_file: "safe", write_file: "unsafe" });
  });

  it("refuses to run without a connection, even if the capability is enabled", async () => {
    const sandbox = createSandboxToolkit({});
    const result = await run(sandbox, "run_command", { command: "ls" });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("SANDBOX_HOST");
  });

  it("wraps detached commands in setsid/nohup and returns the pid line", async () => {
    const connection = fakeSandboxConnection({
      exec: (c) => ({ stdout: c.includes("setsid") ? "4242" : "no" }),
    });
    const sandbox = createSandboxToolkit({ connection });
    const result = await run(sandbox, "run_command", { command: "npm run build", detached: true });
    expect(result.isError).toBeUndefined();
    expect(connection.execs[0]!.command).toMatch(/^setsid nohup sh -c 'npm run build' >/);
    expect(result.text).toContain("4242");
  });

  it("describes a binary file instead of corrupting it", async () => {
    const files = new Map([
      ["/blob.bin", Buffer.from([0xff, 0xfe, 0x00, 0x81])],
      ["/cut.txt", Buffer.from("añb")],
    ]);
    const sandbox = createSandboxToolkit({ connection: fakeSandboxConnection({ files }) });
    const binary = await run(sandbox, "read_file", { path: "/blob.bin" });
    expect(binary.text).toMatch(/^\[binary file, 4 bytes\]/);
    const cut = await run(sandbox, "read_file", { path: "/cut.txt", max_bytes: 2 });
    expect(cut.text).toBe("a�");
    expect(cut.details).toEqual({ truncated: true });
  });
});

describe("sandbox toolkit (integration, in-process SSH server)", () => {
  let server: Awaited<ReturnType<typeof startFakeSandboxServer>>;
  let connection: SandboxConnection;

  beforeAll(async () => {
    server = await startFakeSandboxServer((command) => {
      if (command.startsWith("echo ")) return { stdout: command.slice(5) };
      if (command === "false") return { stdout: "", exitCode: 1 };
      return { stdout: "" };
    });
    connection = createSandboxConnection({ host: "127.0.0.1", port: server.port });
  });

  afterAll(() => {
    connection?.close();
    server?.close();
  });

  const toolkit = () => createSandboxToolkit({ connection });

  it("runs commands over the real ssh2 client with none-auth", async () => {
    const result = await run(toolkit(), "run_command", { command: "echo hello from the wire" });
    expect(result.text).toContain("hello from the wire");
    expect(server.execCalls).toContain("echo hello from the wire");
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
    const result = await run(toolkit(), "read_file", { path: "/nope.txt" });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/no such file/i);
  });

  it("reports nonzero exits from the real server", async () => {
    const result = await run(toolkit(), "run_command", { command: "false" });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("exit 1");
  });
});
