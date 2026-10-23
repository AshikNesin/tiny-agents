/**
 * The terminal service port (issue #28): tabs on the sandbox VM are tmux
 * sessions, and this service owns their lifecycle. Pure orchestration over
 * the tmux command builders (`tmux.ts`) — all I/O goes through the
 * `TerminalTransport` port, so tests and the app can substitute the
 * binding (`terminal-ssh2.ts`).
 */
import type { Duplex } from "node:stream";
import type { HostKeyStore } from "../toolkits/sandbox-ssh2";
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
  parseSessionList,
  type SessionName,
} from "./tmux";

/** One tmux invocation's outcome, stdout and stderr kept apart for parsing. */
export interface TerminalExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * A live attach: a duplex of raw pty bytes. `setWindow` follows a client
 * resize through to the pty; `done` settles when the remote side ends
 * (tmux exited or detached this client) carrying its exit code, so a
 * bridge can tell a failed attach (nonzero, no bytes) from a detach.
 */
export interface PtyStream extends Duplex {
  setWindow(rows: number, cols: number): void;
  done: Promise<{ exitCode: number | null }>;
}

/** The transport port: production is ssh2 (`terminal-ssh2.ts`), tests fake it. */
export interface TerminalTransport {
  exec(command: string): Promise<TerminalExecResult>;
  pty(command: string, init: { term: string; cols: number; rows: number }): Promise<PtyStream>;
}

export type TerminalStatus =
  | { kind: "ready" }
  | { kind: "unconfigured" }
  | { kind: "unreachable"; message: string }
  | { kind: "tmux-missing"; installCommand: string };

/** The install line the tmux-missing state offers (Ubuntu on the sandbox VM). */
export const TMUX_INSTALL_COMMAND = "sudo apt-get install -y tmux";

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

export interface TerminalServiceListResult {
  status: TerminalStatus;
  sessions: TerminalSessionRow[];
}

export interface TerminalService {
  status(): Promise<TerminalStatus>;
  /** One exec answers both the status and the tab list (the poll path). */
  list(): Promise<TerminalServiceListResult>;
  create(cols: number, rows: number): Promise<TerminalSessionRow>;
  kill(name: SessionName, options?: { force?: boolean }): Promise<void>;
  has(name: SessionName): Promise<boolean>;
  attach(name: SessionName, init: { cols: number; rows: number }): Promise<PtyStream>;
}

export interface TerminalServiceOptions {
  host?: string;
  port?: number;
  user?: string;
  hostKeys?: HostKeyStore;
  /** Substitutable transport; default is the ssh2 binding. */
  transport?: TerminalTransport;
}

/** One readable line for a connection failure, never a stack trace. */
function describeUnreachable(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  // Errors can pass through more than one layer that describes them; wrap
  // once, or the UI reads "Cannot reach the sandbox (Cannot reach …)".
  if (message.startsWith("Cannot reach the sandbox")) return message;
  return /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH/.test(message)
    ? `Cannot reach the sandbox (${message}). Is it online and on the tailnet?`
    : message;
}

export function createTerminalService(
  options: TerminalServiceOptions = {},
): TerminalService & { readonly configured: boolean } {
  // The transport import stays dynamic-shaped so the app layer can inject a
  // fake without ssh2 ever loading; production wires the real binding lazily.
  const transport =
    options.transport ??
    (options.host
      ? lazySsh2Transport(() => ({
          host: options.host!,
          port: options.port ?? 22,
          user: options.user ?? "exedev",
          hostKeys: options.hostKeys,
        }))
      : undefined);
  const configured = Boolean(transport);

  const exec = async (command: string): Promise<TerminalExecResult> => {
    if (!transport) {
      throw new TerminalUnreachableError("Sandbox is not configured: set SANDBOX_HOST.");
    }
    try {
      return await transport.exec(command);
    } catch (error) {
      throw new TerminalUnreachableError(describeUnreachable(error));
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
        status: { kind: "unreachable", message: describeUnreachable(error) },
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
    async create(cols, rows) {
      const sessions = await requireReady();
      const name = allocateSessionName(sessions.map((s) => s.name));
      if (!name) throw new SessionLimitError();
      const made = await exec(newSessionCommand(name, cols, rows));
      if (made.exitCode !== 0) {
        throw new TerminalUnreachableError(made.stderr.trim() || "tmux new-session failed");
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
      if (!transport) {
        throw new TerminalUnreachableError("Sandbox is not configured: set SANDBOX_HOST.");
      }
      try {
        return await transport.pty(attachCommand(name), {
          term: TERM,
          cols: init.cols,
          rows: init.rows,
        });
      } catch (error) {
        throw new TerminalUnreachableError(describeUnreachable(error));
      }
    },
  };
}

type ConnectShape = {
  host: string;
  port: number;
  user: string;
  hostKeys?: HostKeyStore;
};

/**
 * The ssh2 binding is imported lazily so a substitutable transport in tests
 * (or an unconfigured app) never pulls ssh2 into the module graph.
 */
function lazySsh2Transport(connect: () => ConnectShape): TerminalTransport {
  let bound: TerminalTransport | undefined;
  return {
    async exec(command) {
      bound ??= await loadTransport(connect);
      return bound.exec(command);
    },
    async pty(command, init) {
      bound ??= await loadTransport(connect);
      return bound.pty(command, init);
    },
  };
}

async function loadTransport(connect: () => ConnectShape): Promise<TerminalTransport> {
  const { createSsh2TerminalTransport } = await import("./terminal-ssh2");
  return createSsh2TerminalTransport(connect());
}
