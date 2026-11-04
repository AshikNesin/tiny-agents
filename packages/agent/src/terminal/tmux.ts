/**
 * Pure tmux domain (issue #28): the exact command lines the terminal
 * feature runs on the sandbox VM, plus the parsing/allocation rules around
 * them. No I/O here — the service layer executes these strings and feeds
 * their output back.
 *
 * Every tmux invocation is prefixed `LC_ALL=C.UTF-8`. ssh2 exec sessions
 * carry no LANG, and tmux 3.4 then falls back to a non-UTF-8 locale, where
 * it (a) replaces TAB with `_` in `ls -F` output, breaking the frozen
 * wire format, and (b) mangles every non-ASCII byte it draws to an
 * attached client. The prefix must also be on `new-session` so the tmux
 * *server* itself starts UTF-8. Verified live against tiny-agents-vm
 * (tmux 3.4, locale C.utf8 present).
 */
const LC_ALL = "LC_ALL=C.UTF-8";

/** Dedicated tmux socket: the owner's own tmux server is never touched. */
export const TMUX_SOCKET = "ta-terminal";

/** Session names are `ta-term-<n>` on that socket. */
export const SESSION_PREFIX = "ta-term-";

/** The terminal type every attach requests. */
export const TERM = "xterm-256color";

/** Tab cap. Creating past this is a SessionLimitError. */
export const MAX_SESSIONS = 12;

/** tmux history lines kept per session (the scrollback survives attaches). */
export const SCROLLBACK = 50_000;

declare const sessionNameBrand: unique symbol;

/** A tmux session name this feature owns. Only parseSessionName constructs it. */
export type SessionName = string & { readonly [sessionNameBrand]: true };

const NAME_PATTERN = /^ta-term-(\d+)$/;

/** Parse a raw string into a SessionName, or undefined when foreign/malformed. */
export function parseSessionName(raw: string): SessionName | undefined {
  return NAME_PATTERN.test(raw) ? (raw as SessionName) : undefined;
}

/** The `<n>` of a `ta-term-<n>` name. */
export function sessionNumber(name: SessionName): number {
  return Number(NAME_PATTERN.exec(name)![1]);
}

function tmux(args: string): string {
  return `${LC_ALL} tmux -L ${TMUX_SOCKET} ${args}`;
}

/**
 * One exec that answers both "is tmux installed" and "what sessions exist":
 * `tmux -V` gates the ls, so a tmux installed mid-flight is seen on the
 * next poll. The format's separators are real TAB bytes — tmux 3.4 does not
 * expand `\t` escapes in formats.
 */
export function listCommand(): string {
  const format = `'#{session_name}\t#{session_created}\t#{session_attached}\t#{pane_current_command}'`;
  return `${LC_ALL} tmux -V && ${LC_ALL} tmux -L ${TMUX_SOCKET} ls -F ${format}`;
}

/** tmux version probe (the tmux-missing check on its own). */
export function versionCommand(): string {
  return `${LC_ALL} tmux -V`;
}

/**
 * The terminal settings, as one `\;`-joined tmux chain. Every entry is
 * idempotent (plain `set`, an indexed `terminal-features` slot rather than
 * `-a`, bind/unbind), so it runs on every create AND every attach: a tmux
 * server started by an older build picks the settings up on the next
 * attach instead of needing a restart.
 *
 * - `status off`, `mouse on`, `history-limit`, `escape-time`: the tab is the
 *   whole window, the wheel scrolls tmux's history (the real scrollback), and
 *   Esc is not held long enough to feel laggy in vim.
 * - `set-clipboard on` + the `clipboard` feature: a mouse selection in tmux
 *   (drag, double-click) is sent to the browser as OSC 52, and the page's
 *   clipboard handler writes it to the system clipboard. Without the
 *   feature tmux never learns the outer terminal can take it.
 * - `RGB`: 24-bit colour passes through instead of being squashed to 256.
 * - `hyperlinks`: OSC 8 links reach xterm, which makes them clickable.
 * - `window-size latest`: every browser tab is its own tmux client (no
 *   `attach -d` kicking the other device off); the one typing sizes it.
 * - `focus-events`: vim/TUIs learn when the browser tab loses focus.
 * - Shift+PageUp/PageDown page through tmux history from the keyboard.
 * - Right-click is unbound so tmux's own popup menu never appears over the
 *   page's context menu (Copy/Paste), which the browser shows instead.
 */
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

/** tmux commands joined into one invocation's chain. */
const chain = (commands: readonly string[]): string => commands.join(" \\; ");

/**
 * Create a detached session and apply the terminal settings in the same
 * command. `set -g` runs against the fresh server, so it applies to every
 * later session on the socket too; re-running it is idempotent.
 */
export function newSessionCommand(name: SessionName, cols: number, rows: number): string {
  return tmux(chain([`new-session -d -s ${name} -x ${cols} -y ${rows}`, ...TERMINAL_SETTINGS]));
}

/**
 * Attach as one more client of the session. No `-d`: detaching the other
 * viewers made a tab open on a second device (or a second browser tab)
 * close the first one for good. tmux keeps every client in sync and
 * `window-size latest` lets the most recently active one set the size.
 * The settings run first so the attach itself sees them.
 */
export function attachCommand(name: SessionName): string {
  return tmux(chain([...TERMINAL_SETTINGS, `attach-session -t ${name}`]));
}

export function killCommand(name: SessionName): string {
  return tmux(`kill-session -t ${name}`);
}

/** Exit 0 iff the session exists. */
export function hasSessionCommand(name: SessionName): string {
  return tmux(`has-session -t ${name}`);
}

/**
 * The pane's foreground process, read only where it is needed (delete-time
 * busy check). Note: tmux 3.4 exits 0 with empty output for a missing
 * target, so callers treat empty stdout as "unknown", not "found".
 */
export function foregroundCommand(name: SessionName): string {
  return tmux(`display-message -p -t ${name} '#{pane_current_command}'`);
}

/**
 * The user's login shell name, read from the VM rather than assumed — the
 * busy rule compares the pane's foreground process against it.
 */
export function loginShellCommand(): string {
  return `sh -c 'basename "$SHELL"'`;
}

/** One row of the session listing. */
export interface TmuxSessionRow {
  name: SessionName;
  /** tmux session_created: epoch seconds. */
  createdAt: number;
  /** session_attached > 0: at least one client is attached. */
  attached: boolean;
  /** pane_current_command of the active pane; null when tmux reported none. */
  command: string | null;
}

export type ParsedSessionList =
  | { kind: "ok"; sessions: TmuxSessionRow[] }
  | { kind: "tmux-missing" }
  | { kind: "error"; message: string };

const NO_SERVER = /no server running|error connecting/;
const NOT_FOUND = /not found/i;

/**
 * Parse the chained `tmux -V && tmux ls` result. The "no server" case is an
 * empty list, not an error: a socket with no sessions is the normal state
 * before the first tab. Any line that is not a well-formed ta-term row
 * (the `tmux 3.4` header included) is dropped — the socket is dedicated,
 * so a foreign name is not ours to manage.
 */
export function parseSessionList(
  stdout: string,
  stderr: string,
  exitCode: number,
): ParsedSessionList {
  if (exitCode === 127 || NOT_FOUND.test(stderr)) return { kind: "tmux-missing" };
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

/**
 * Lowest free `ta-term-<n>` (1-based), undefined at the cap. Names never
 * shuffle: an existing hole is reused, so tabs keep their numbers across
 * deletes.
 */
export function allocateSessionName(existing: Iterable<SessionName>): SessionName | undefined {
  const taken = new Set([...existing].map(sessionNumber));
  for (let n = 1; n <= MAX_SESSIONS; n++) {
    if (!taken.has(n)) return `${SESSION_PREFIX}${n}` as SessionName;
  }
  return undefined;
}

/**
 * A tab is busy when its pane runs something other than the login shell
 * (vim, htop, a build). Closing it would kill real work, so the route asks
 * for confirmation first. A null foreground means the read failed — the
 * session usually vanished, and the kill-session that follows reports 404;
 * a null login shell (the read of $SHELL failed) reads as busy, the safe
 * side of the confirm.
 */
export function isBusy(foreground: string | null, loginShell: string | null): boolean {
  if (!foreground) return false;
  if (!loginShell) return true;
  return foreground !== loginShell;
}
