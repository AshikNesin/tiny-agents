/**
 * `@tiny-agents/agent/terminal`: tmux-backed terminal tabs on the sandbox VM,
 * over the sandbox connection. Nothing here touches pi-durable.
 */
export {
  createTerminalService,
  SessionBusyError,
  SessionLimitError,
  SessionNotFoundError,
  TerminalUnreachableError,
  TmuxMissingError,
  type PtyStream,
  type TerminalConnection,
  type TerminalService,
  type TerminalServiceOptions,
  type TerminalSessionRow,
  type TerminalStatus,
} from "../terminal/terminal";
export { parseSessionName, type SessionName } from "../terminal/tmux";
