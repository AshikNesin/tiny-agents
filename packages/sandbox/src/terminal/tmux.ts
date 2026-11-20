import { EXIT_COMMAND_NOT_FOUND, shQuote } from "../shell";

const LC_ALL = "LC_ALL=C.UTF-8";

const TMUX_SOCKET = "ta-terminal";

const SESSION_PREFIX = "ta-term-";

export const TERM = "xterm-256color";

export const MAX_SESSIONS = 12;

const SCROLLBACK = 50_000;

declare const sessionNameBrand: unique symbol;

export type SessionName = string & { readonly [sessionNameBrand]: true };

const NAME_PATTERN = /^ta-term-(\d+)$/;

export function parseSessionName(raw: string): SessionName | undefined {
  return NAME_PATTERN.test(raw) ? (raw as SessionName) : undefined;
}

export function sessionNumber(name: SessionName): number {
  return Number(NAME_PATTERN.exec(name)![1]);
}

function tmux(args: string): string {
  return `${LC_ALL} tmux -L ${TMUX_SOCKET} ${args}`;
}

export function listCommand(): string {
  const format = `'#{session_name}\t#{session_created}\t#{session_attached}\t#{pane_current_command}'`;
  return `${LC_ALL} tmux -V && ${LC_ALL} tmux -L ${TMUX_SOCKET} ls -F ${format}`;
}

export function versionCommand(): string {
  return `${LC_ALL} tmux -V`;
}

export const TERMINAL_SETTINGS: readonly string[] = [
  "set -g status off",
  "set -g mouse on",
  `set -g history-limit ${SCROLLBACK}`,
  "set -s escape-time 10",
  "set -s set-clipboard on",
  "set -s focus-events on",
  "set -g window-size latest",
  `set -s 'terminal-features[90]' 'xterm*:RGB:clipboard:hyperlinks:strikethrough:usstyle:overline'`,
  "bind -n S-PPage copy-mode -eu",
  "bind -T copy-mode S-PPage send -X page-up",
  "bind -T copy-mode S-NPage send -X page-down",
  "unbind -n MouseDown3Pane",
  "unbind -n M-MouseDown3Pane",
  "unbind -n MouseDown3Status",
  "unbind -n MouseDown3StatusLeft",
];

const chain = (commands: readonly string[]): string => commands.join(" \\; ");

export function newSessionCommand(name: SessionName, cols: number, rows: number): string {
  return tmux(chain([`new-session -d -s ${name} -x ${cols} -y ${rows}`, ...TERMINAL_SETTINGS]));
}

export function typeLineCommand(name: SessionName, line: string): string {
  const literal = shQuote(line);
  return tmux(`send-keys -t ${name} -l ${literal}`) + ` \\; send-keys -t ${name} Enter`;
}

export function attachCommand(name: SessionName): string {
  return tmux(chain([...TERMINAL_SETTINGS, `attach-session -t ${name}`]));
}

export function killCommand(name: SessionName): string {
  return tmux(`kill-session -t ${name}`);
}

export function hasSessionCommand(name: SessionName): string {
  return tmux(`has-session -t ${name}`);
}

export function foregroundCommand(name: SessionName): string {
  return tmux(`display-message -p -t ${name} '#{pane_current_command}'`);
}

export function loginShellCommand(): string {
  return `sh -c 'basename "$SHELL"'`;
}

interface TmuxSessionRow {
  name: SessionName;
  createdAt: number;
  attached: boolean;
  command: string | null;
}

export type ParsedSessionList =
  | { kind: "ok"; sessions: TmuxSessionRow[] }
  | { kind: "tmux-missing" }
  | { kind: "error"; message: string };

const NO_SERVER = /no server running|error connecting/;
const NOT_FOUND = /not found/i;

export function parseSessionList(
  stdout: string,
  stderr: string,
  exitCode: number,
): ParsedSessionList {
  if (exitCode === EXIT_COMMAND_NOT_FOUND || NOT_FOUND.test(stderr))
    return { kind: "tmux-missing" };
  if (exitCode !== 0) {
    if (NO_SERVER.test(stderr)) return { kind: "ok", sessions: [] };
    return { kind: "error", message: stderr.trim() || `tmux ls exited ${exitCode}` };
  }
  const sessions: TmuxSessionRow[] = [];
  for (const line of stdout.split("\n")) {
    if (!line) continue;
    const [name, created, attached, command] = line.split("\t");
    const parsed = name ? parseSessionName(name) : undefined;
    if (!parsed || created === undefined || attached === undefined) continue;
    const createdAt = Number(created);
    if (!Number.isFinite(createdAt)) continue;
    sessions.push({
      name: parsed,
      createdAt,
      attached: attached !== "0",
      command: command ? command : null,
    });
  }
  return { kind: "ok", sessions };
}

export function allocateSessionName(existing: Iterable<SessionName>): SessionName | undefined {
  const taken = new Set([...existing].map(sessionNumber));
  for (let n = 1; n <= MAX_SESSIONS; n++) {
    if (!taken.has(n)) return `${SESSION_PREFIX}${n}` as SessionName;
  }
  return undefined;
}

export function isBusy(foreground: string | null, loginShell: string | null): boolean {
  if (!foreground) return false;
  if (!loginShell) return true;
  return foreground !== loginShell;
}
