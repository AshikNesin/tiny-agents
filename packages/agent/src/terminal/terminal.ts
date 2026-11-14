/**
 * The terminal service port (issue #28): tabs on the sandbox VM are tmux
 * sessions, and this service owns their lifecycle. Pure orchestration over
 * the tmux command builders (`tmux.ts`): all I/O goes through the app's
 * `SandboxConnection` (execs and pty attaches share its pooled connection,
 * issue #84), which tests substitute.
 */
import type { PtyStream } from "../ssh/pty-stream";
import type { SandboxConnection } from "../ssh/sandbox-connection";
import {
  MAX_SESSIONS,
  TERM,
  allocateSessionName,
  attachCommand,
  foregroundCommand,
  hasSessionCommand,
  isBusy,
  killCommand,
  listCommand,
  loginShellCommand,
  newSessionCommand,
  typeLineCommand,
  parseSessionList,
  type SessionName,
} from "./tmux";

/** One tmux invocation's outcome, stdout and stderr kept apart for parsing. */
interface TerminalExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type { PtyStream } from "../ssh/pty-stream";

/** What the service needs of the sandbox connection. */
export type TerminalConnection = Pick<SandboxConnection, "exec" | "pty">;

export type TerminalStatus =
  | { kind: "ready" }
  | { kind: "unconfigured" }
  | { kind: "unreachable"; message: string }
  | { kind: "tmux-missing"; installCommand: string };

/** The install line the tmux-missing state offers (Ubuntu on the sandbox VM). */
const TMUX_INSTALL_COMMAND = "sudo apt-get install -y tmux";

export class TerminalUnreachableError extends Error {}
export class TmuxMissingError extends Error {
  readonly installCommand = TMUX_INSTALL_COMMAND;
}
export class SessionLimitError extends Error {
  constructor() {
    super(`Terminal tab limit reached (${MAX_SESSIONS}).`);
  }
}
export class SessionNotFoundError extends Error {
  constructor(name: string) {
    super(`No terminal session named ${name}.`);
  }
}
export class SessionBusyError extends Error {
  constructor(
    name: string,
    readonly foreground: string | null,
  ) {
    super(`${name} is running ${foreground ?? "an unknown process"}.`);
  }
}

/** One tab, as the service reports it. createdAt is epoch seconds from tmux. */
export interface TerminalSessionRow {
  name: SessionName;
  /** The pane's foreground process, when tmux reported one. */
  foreground: string | null;
  attached: boolean;
  createdAt: number;
}

interface TerminalServiceListResult {
  status: TerminalStatus;
  sessions: TerminalSessionRow[];
}

export interface TerminalService {
  status(): Promise<TerminalStatus>;
  /** One exec answers both the status and the tab list (the poll path). */
  list(): Promise<TerminalServiceListResult>;
  /** `typeLine` is typed into the new tab's shell (e.g. a sign-in command). */
  create(cols: number, rows: number, options?: { typeLine?: string }): Promise<TerminalSessionRow>;
  kill(name: SessionName, options?: { force?: boolean }): Promise<void>;
  has(name: SessionName): Promise<boolean>;
  attach(name: SessionName, init: { cols: number; rows: number }): Promise<PtyStream>;
}

export interface TerminalServiceOptions {
  /** The app's sandbox connection; unset = no sandbox configured. */
  connection?: TerminalConnection;
}

/** The connection already words "Cannot reach the sandbox"; keep its message. */
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function createTerminalService(
  options: TerminalServiceOptions = {},
): TerminalService & { readonly configured: boolean } {
  const connection = options.connection;
  const configured = Boolean(connection);

  const exec = async (command: string): Promise<TerminalExecResult> => {
    if (!connection) {
      throw new TerminalUnreachableError("Sandbox is not configured: set SANDBOX_HOST.");
    }
    try {
      const result = await connection.exec(command);
      return {
        stdout: result.stdout.toString("utf8"),
        stderr: result.stderr,
        exitCode: result.exitCode,
      };
    } catch (error) {
      throw new TerminalUnreachableError(messageOf(error));
    }
  };

  const listInternal = async (): Promise<TerminalServiceListResult> => {
    if (!configured) return { status: { kind: "unconfigured" }, sessions: [] };
    let result: TerminalExecResult;
    try {
      result = await exec(listCommand());
    } catch (error) {
      // The poll path reports reachability as status, not as a throw: the
      // tab strip still renders an empty list beside an error chip.
      return {
        status: { kind: "unreachable", message: messageOf(error) },
        sessions: [],
      };
    }
    const parsed = parseSessionList(result.stdout, result.stderr, result.exitCode);
    if (parsed.kind === "ok") {
      return {
        status: { kind: "ready" },
        sessions: parsed.sessions.map((row) => ({
          name: row.name,
          foreground: row.command,
          attached: row.attached,
          createdAt: row.createdAt,
        })),
      };
    }
    if (parsed.kind === "tmux-missing") {
      return {
        status: { kind: "tmux-missing", installCommand: TMUX_INSTALL_COMMAND },
        sessions: [],
      };
    }
    return { status: { kind: "unreachable", message: parsed.message }, sessions: [] };
  };

  const requireReady = async (): Promise<TerminalSessionRow[]> => {
    const { status, sessions } = await listInternal();
    if (status.kind === "tmux-missing") throw new TmuxMissingError(status.installCommand);
    if (status.kind !== "ready") {
      throw new TerminalUnreachableError(
        status.kind === "unreachable"
          ? status.message
          : "Sandbox is not configured: set SANDBOX_HOST.",
      );
    }
    return sessions;
  };

  const singleLine = (result: TerminalExecResult): string => result.stdout.trim();

  return {
    configured,
    async status() {
      return (await listInternal()).status;
    },
    list: listInternal,
    async create(cols, rows, createOptions) {
      const sessions = await requireReady();
      const name = allocateSessionName(sessions.map((s) => s.name));
      if (!name) throw new SessionLimitError();
      const made = await exec(newSessionCommand(name, cols, rows));
      if (made.exitCode !== 0) {
        throw new TerminalUnreachableError(made.stderr.trim() || "tmux new-session failed");
      }
      if (createOptions?.typeLine) {
        const typed = await exec(typeLineCommand(name, createOptions.typeLine));
        if (typed.exitCode !== 0) {
          throw new TerminalUnreachableError(typed.stderr.trim() || "tmux send-keys failed");
        }
      }
      // Re-list rather than fabricate: tmux owns createdAt, and the pane's
      // foreground may already be visible.
      const row = (await requireReady()).find((s) => s.name === name);
      return (
        row ?? { name, foreground: null, attached: false, createdAt: Math.floor(Date.now() / 1000) }
      );
    },
    async kill(name, killOptions) {
      if (!killOptions?.force) {
        const foreground = singleLine(await exec(foregroundCommand(name)));
        // tmux 3.4 exits 0 with empty output for a missing target.
        if (!foreground) throw new SessionNotFoundError(name);
        const loginShell = singleLine(await exec(loginShellCommand()));
        if (isBusy(foreground, loginShell || null)) throw new SessionBusyError(name, foreground);
      }
      const killed = await exec(killCommand(name));
      if (killed.exitCode !== 0) {
        if (/can't find session|no such session/i.test(killed.stderr)) {
          throw new SessionNotFoundError(name);
        }
        throw new TerminalUnreachableError(killed.stderr.trim() || "tmux kill-session failed");
      }
    },
    async has(name) {
      return (await exec(hasSessionCommand(name))).exitCode === 0;
    },
    async attach(name, init) {
      if (!connection) {
        throw new TerminalUnreachableError("Sandbox is not configured: set SANDBOX_HOST.");
      }
      try {
        return await connection.pty(attachCommand(name), {
          term: TERM,
          cols: init.cols,
          rows: init.rows,
        });
      } catch (error) {
        throw new TerminalUnreachableError(messageOf(error));
      }
    },
  };
}
