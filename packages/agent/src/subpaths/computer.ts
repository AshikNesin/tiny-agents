/**
 * `@tiny-agents/agent/computer`: moved to `@tiny-agents/sandbox/computer`
 * (rewrite step 3.4). Re-exported so importers of this subpath keep
 * compiling; nothing in this repo imports them from here. The computer
 * toolkit the bots call stays on the package root.
 */
export {
  /** @deprecated Import from `@tiny-agents/sandbox/computer`. */
  closeAllComputerSessions,
  /** @deprecated Import from `@tiny-agents/sandbox/computer`. */
  createComputerSessions,
  /** @deprecated Import from `@tiny-agents/sandbox/computer`. */
  createX11ComputerTransport,
  /** @deprecated Import from `@tiny-agents/sandbox/computer`. */
  parseDesktopSize,
  /** @deprecated Import from `@tiny-agents/sandbox/computer`. */
  parseExtraPackages,
} from "@tiny-agents/sandbox/computer";
export type {
  /** @deprecated Import from `@tiny-agents/sandbox/computer`. */
  ComputerSessions,
  /** @deprecated Import from `@tiny-agents/sandbox/computer`. */
  ComputerSessionsOptions,
  /** @deprecated Import from `@tiny-agents/sandbox/computer`. */
  ComputerTransport,
  /** @deprecated Import from `@tiny-agents/sandbox/computer`. */
  X11ComputerTransportOptions,
} from "@tiny-agents/sandbox/computer";
