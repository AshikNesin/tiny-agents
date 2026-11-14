/** The Terminal API's wire types (`server/api/terminal`, issue #28); naming in `./common.ts`. */

/** One tmux-backed tab on the sandbox VM. */
export interface TerminalSession {
  name: string;
  /** Foreground process (pane_current_command); null when idle at the shell. */
  process: string | null;
  /** A viewer is currently attached to this tab. */
  attached: boolean;
  /** ISO time the tab was created. */
  createdAt: string;
}

/** Server availability: drives the page's setup/error/empty states. */
export type TerminalStatusWire =
  | { kind: "ready" }
  | { kind: "unconfigured" }
  | { kind: "unreachable"; message: string }
  | { kind: "tmux-missing"; installCommand: string };

/** `GET /terminal/sessions` answers availability and tabs in one dial. */
export interface TerminalList {
  status: TerminalStatusWire;
  sessions: TerminalSession[];
}

/** `POST /terminal/sessions`: `run` types a fixed command into the new tab. */
export interface TerminalCreateBody {
  cols?: number;
  rows?: number;
  run?: "claude-login";
}

/** `POST /terminal/sessions/:name/ticket`: the same-origin WS path, ticket included. */
export interface TerminalTicket {
  path: string;
}

/**
 * Why a DELETE was refused (409): the tab's pane is running something
 * besides the login shell. `process` is the foreground process name when the
 * server sent it (`error.details.process`).
 */
export interface TerminalCloseBlocked {
  message: string;
  process?: string;
}
