export interface TerminalSession {
  name: string;
  process: string | null;
  attached: boolean;
  createdAt: string;
}

export type TerminalStatusWire =
  | { kind: "ready" }
  | { kind: "unconfigured" }
  | { kind: "unreachable"; message: string }
  | { kind: "tmux-missing"; installCommand: string };

export interface TerminalList {
  status: TerminalStatusWire;
  sessions: TerminalSession[];
}

export interface TerminalCreateBody {
  cols?: number;
  rows?: number;
  run?: "claude-login";
}

export interface TerminalTicket {
  path: string;
}

export interface TerminalCloseBlocked {
  message: string;
  process?: string;
}
