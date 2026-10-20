/**
 * The `sandbox` toolkit (issue #19): a keyless shell on the shared sandbox
 * VM over Tailscale SSH. The tailnet is the authentication (no keys, no
 * passwords — the tagged node identity is what the ACL accepts), so the
 * toolkit only needs a host, a port and a unix user.
 *
 * Transport is a narrow port (`sandbox-ssh2`) so tests and the app can
 * substitute it; ssh2 is the production default.
 *
 * Replay: `read_file` is pure (`safe`); `run_command` and `write_file`
 * have side effects and stay `unsafe` — the approval gate's start-marked
 * memo (`approvals.ts`) then reports "interrupted" on a crash instead of
 * re-running a command or a write.
 */
import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool, type ToolExecutionResult } from "@earendil-works/pi-durable";
import type { Capability } from "../capabilities";
import { createSsh2Transport, type HostKeyStore } from "./sandbox-ssh2";

/** One command's outcome: combined output plus exit status. */
export interface ExecResult {
  output: string;
  exitCode: number;
}

export interface ExecOptions {
  timeoutMs?: number;
}

/** What the tools need from a live connection — the whole SSH surface they see. */
export interface SandboxSession {
  exec(command: string, options?: ExecOptions): Promise<ExecResult>;
  readFile(
    path: string,
    options?: { maxBytes?: number },
  ): Promise<{ text: string; truncated: boolean }>;
  writeFile(path: string, content: string): Promise<void>;
  close(): void;
}

export interface ConnectOptions {
  host: string;
  port: number;
  user: string;
  hostKeys?: HostKeyStore;
  connectTimeoutMs?: number;
}

/** The transport port: production is ssh2, tests substitute fakes. */
export type SandboxTransport = (options: ConnectOptions) => Promise<SandboxSession>;

export type { HostKeyStore } from "./sandbox-ssh2";
export { createMemoryHostKeyStore, createSsh2Transport } from "./sandbox-ssh2";

export interface SandboxToolkitOptions {
  /** MagicDNS name or Tailscale IP of the sandbox VM. */
  host?: string;
  port?: number;
  /** Unix user for the session; must match the ACL rule's `users`. Default `exedev`. */
  user?: string;
  /** TOFU host-key pinning; unset trusts every connection (WireGuard still authenticates the endpoint). */
  hostKeys?: HostKeyStore;
  /** Override for tests or alternate transports. Default: ssh2. */
  transport?: SandboxTransport;
  /** Command timeout in seconds (default 120). */
  defaultTimeoutSecs?: number;
}

const fail = (text: string): ToolExecutionResult => ({
  output: [{ type: "text", text }],
  isError: true,
});

/** One readable line per error: connection failures must not be stack traces. */
function describe(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH/.test(message)
    ? `Cannot reach the sandbox (${message}). Is it online and on the tailnet?`
    : message;
}

export function createSandboxToolkit(options: SandboxToolkitOptions = {}): Capability {
  const configured = Boolean(options.host);
  const transport = options.transport ?? createSsh2Transport();

  // One pooled connection per toolkit instance (one per server process when
  // wired in bots.runtime.ts), opened lazily on first tool use. Concurrent
  // tools share it — ssh2 multiplexes exec/SFTP channels over one connection.
  let session: Promise<SandboxSession> | undefined;
  const dial = (): Promise<SandboxSession> => {
    const attempt = transport({
      host: options.host!,
      port: options.port ?? 22,
      user: options.user ?? "exedev",
      hostKeys: options.hostKeys,
    });
    attempt.catch(() => {
      if (session === attempt) session = undefined; // don't cache a failed dial
    });
    return attempt;
  };

  const withSession = <T>(fn: (s: SandboxSession) => Promise<T>): Promise<T> => {
    const run = (s: Promise<SandboxSession>) =>
      s.then(fn, (error) => {
        throw error;
      });
    return run((session ??= dial())).catch((error) => {
      // A dead pooled connection (keepalive timeout, VM reboot) is retried
      // once on a fresh one — reconnect, not a tool error.
      session = undefined;
      return run((session = dial()));
    });
  };

  const runCommand = defineTool({
    name: "run_command",
    description:
      "Run a shell command on the sandbox VM and return stdout, stderr and the exit code. " +
      "One command string per call — chain with && or ; for steps. " +
      "Set detached:true for long builds or servers: the command keeps running after this call returns.",
    parameters: Type.Object({
      command: Type.String({ minLength: 1, maxLength: 20_000 }),
      detached: Type.Optional(Type.Boolean()),
      timeout_secs: Type.Optional(Type.Integer({ minimum: 1, maximum: 600 })),
    }),
    replay: "unsafe",
    execute: async (args) => {
      const timeoutMs = (args.timeout_secs ?? options.defaultTimeoutSecs ?? 120) * 1000;
      try {
        const result = await withSession((s) =>
          s.exec(
            args.detached
              ? `setsid nohup ${args.command} > /tmp/ta-detached-$$.log 2>&1 < /dev/null & printf '%s' "$!"`
              : args.command,
            { timeoutMs },
          ),
        );
        if (result.exitCode !== 0) {
          return {
            output: [{ type: "text", text: `exit ${result.exitCode}\n${result.output}` }],
            isError: true,
            details: { exitCode: result.exitCode },
          };
        }
        return {
          output: [{ type: "text", text: result.output }],
          details: { exitCode: result.exitCode },
        };
      } catch (error) {
        return fail(describe(error));
      }
    },
  });

  const readFile = defineTool({
    name: "read_file",
    description:
      "Read a file from the sandbox VM. Binary-safe; non-UTF-8 bytes are described, not corrupted. " +
      "Use max_bytes to cap huge files.",
    parameters: Type.Object({
      path: Type.String({ minLength: 1, maxLength: 4096 }),
      max_bytes: Type.Optional(Type.Integer({ minimum: 1, maximum: 1_000_000 })),
    }),
    replay: "safe",
    execute: async (args) => {
      try {
        const file = await withSession((s) =>
          s.readFile(args.path, { maxBytes: args.max_bytes ?? 200_000 }),
        );
        return {
          output: [{ type: "text", text: file.text }],
          details: { truncated: file.truncated },
        };
      } catch (error) {
        return fail(describe(error));
      }
    },
  });

  const writeFile = defineTool({
    name: "write_file",
    description:
      "Create or overwrite a file on the sandbox VM with UTF-8 content. Written to a temp name " +
      "then renamed, so a crash mid-write never leaves a half file.",
    parameters: Type.Object({
      path: Type.String({ minLength: 1, maxLength: 4096 }),
      content: Type.String({ minLength: 1, maxLength: 500_000 }),
    }),
    replay: "unsafe",
    execute: async (args) => {
      try {
        await withSession((s) => s.writeFile(args.path, args.content));
        return { output: [{ type: "text", text: `Wrote ${args.path}` }] };
      } catch (error) {
        return fail(describe(error));
      }
    },
  });

  return {
    id: "sandbox",
    kind: "toolkit",
    name: "Sandbox",
    description: "Keyless shell and files on the sandbox VM over Tailscale SSH",
    extension: defineExtension({ name: "sandbox", tools: [runCommand, readFile, writeFile] }),
    tools: [
      {
        name: "run_command",
        label: "Ran a command",
        description: "Run a shell command on the sandbox VM",
      },
      {
        name: "read_file",
        label: "Read a file",
        description: "Read a file from the sandbox VM",
        readOnly: true,
      },
      {
        name: "write_file",
        label: "Wrote a file",
        description: "Write a file on the sandbox VM",
      },
    ],
    ...(configured ? {} : { setupHint: "Set SANDBOX_HOST to enable the sandbox." }),
  };
}
