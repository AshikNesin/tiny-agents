/**
 * An in-memory `SandboxConnection` for toolkit and transport tests: each
 * method answers from what the test gives it and records the call. The pool,
 * retry, idle close and host keys are tested once, against the fake SSH
 * server, in `sandbox-connection.test.ts`.
 */
import type { Duplex } from "node:stream";
import type {
  SandboxConnection,
  SandboxExecOptions,
  SandboxExecResult,
} from "../../../../packages/sandbox/src/ssh/sandbox-connection";
import type { PtySize, PtyStream } from "../../../../packages/sandbox/src/ssh/pty-stream";

export interface FakeExecReply {
  stdout?: string | Buffer;
  stderr?: string;
  exitCode?: number;
}

export interface FakeSandboxConnectionOptions {
  host?: string;
  exec?: (
    command: string,
    options: SandboxExecOptions,
  ) => FakeExecReply | SandboxExecResult | Promise<FakeExecReply | SandboxExecResult>;
  pty?: (command: string, size: PtySize) => Promise<PtyStream>;
  forward?: (port: number) => Promise<Duplex>;
  files?: Map<string, Buffer>;
}

export interface FakeSandboxConnection extends SandboxConnection {
  execs: { command: string; options: SandboxExecOptions }[];
  forwards: number[];
  writes: { path: string; content: Buffer }[];
  closed: boolean;
}

export function fakeSandboxConnection(
  options: FakeSandboxConnectionOptions = {},
): FakeSandboxConnection {
  const files = options.files ?? new Map<string, Buffer>();
  const connection: FakeSandboxConnection = {
    host: options.host ?? "sandbox.test",
    execs: [],
    forwards: [],
    writes: [],
    closed: false,
    async exec(command, execOptions = {}) {
      connection.execs.push({ command, options: execOptions });
      const reply = (await options.exec?.(command, execOptions)) ?? {};
      return {
        stdout: Buffer.isBuffer(reply.stdout) ? reply.stdout : Buffer.from(reply.stdout ?? ""),
        stderr: reply.stderr ?? "",
        exitCode: reply.exitCode ?? 0,
        truncated: "truncated" in reply && reply.truncated === true,
      };
    },
    async pty(command, size) {
      if (!options.pty) throw new Error("no pty in this fake");
      return options.pty(command, size);
    },
    async readFile(path, readOptions) {
      const bytes = files.get(path);
      if (!bytes) throw new Error(`No such file: ${path}`);
      const max = readOptions?.maxBytes ?? 200_000;
      return { bytes: bytes.subarray(0, max), size: bytes.length, truncated: bytes.length > max };
    },
    async writeFile(path, content) {
      const bytes = typeof content === "string" ? Buffer.from(content) : Buffer.from(content);
      connection.writes.push({ path, content: bytes });
      files.set(path, bytes);
    },
    async forward(port) {
      connection.forwards.push(port);
      if (!options.forward) throw new Error("no forward in this fake");
      return options.forward(port);
    },
    close() {
      connection.closed = true;
    },
  };
  return connection;
}
