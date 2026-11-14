/**
 * `@tiny-agents/agent/terminal`: moved to `@tiny-agents/sandbox/terminal`
 * (rewrite step 3.4). Re-exported so importers of this subpath keep
 * compiling; nothing in this repo imports them from here.
 */
export {
  /** @deprecated Import from `@tiny-agents/sandbox/terminal`. */
  createTerminalService,
  /** @deprecated Import from `@tiny-agents/sandbox/terminal`. */
  parseSessionName,
  /** @deprecated Import from `@tiny-agents/sandbox/terminal`. */
  SessionBusyError,
  /** @deprecated Import from `@tiny-agents/sandbox/terminal`. */
  SessionLimitError,
  /** @deprecated Import from `@tiny-agents/sandbox/terminal`. */
  SessionNotFoundError,
  /** @deprecated Import from `@tiny-agents/sandbox/terminal`. */
  TerminalUnreachableError,
  /** @deprecated Import from `@tiny-agents/sandbox/terminal`. */
  TmuxMissingError,
} from "@tiny-agents/sandbox/terminal";
export type {
  /** @deprecated Import from `@tiny-agents/sandbox/terminal`. */
  PtyStream,
  /** @deprecated Import from `@tiny-agents/sandbox/terminal`. */
  SessionName,
  /** @deprecated Import from `@tiny-agents/sandbox/terminal`. */
  TerminalConnection,
  /** @deprecated Import from `@tiny-agents/sandbox/terminal`. */
  TerminalService,
  /** @deprecated Import from `@tiny-agents/sandbox/terminal`. */
  TerminalServiceOptions,
  /** @deprecated Import from `@tiny-agents/sandbox/terminal`. */
  TerminalSessionRow,
  /** @deprecated Import from `@tiny-agents/sandbox/terminal`. */
  TerminalStatus,
} from "@tiny-agents/sandbox/terminal";
